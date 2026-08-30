import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  getCurrentPlatformUser,
} from "@/lib/auth";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  getDefaultPermissions,
  ROLES,
  PlatformRole,
} from "@/lib/permissions";
export async function GET() {
  try {
    const currentUser = await getCurrentPlatformUser();

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (currentUser.permissions?.manageUsers !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to manage users.",
        },
        { status: 403 }
      );
    }

    const snapshot = await adminDb
      .collection("platformUsers")
      .orderBy("createdAt", "desc")
      .get();

    const users = snapshot.docs.map((doc) => {
      const data = doc.data();

      return {
        id: doc.id,
        name: data.name ?? "",
        email: data.email ?? "",
        role: data.role ?? "",
        active: data.active === true,
      };
    });

    return NextResponse.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Get platform users error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to load platform users.",
      },
      { status: 500 }
    );
  }
}
export async function POST(request: Request) {
  try {
    // 1. Verify current admin session
    const currentUser = await getCurrentPlatformUser();

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    // 2. Verify permission
    if (currentUser.permissions?.manageUsers !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to manage users.",
        },
        { status: 403 }
      );
    }

    // 3. Read request body
    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const password =
      typeof body.password === "string" ? body.password : "";

    const role =
      typeof body.role === "string" ? body.role : "";

    // 4. Validate required fields
    if (!name || !email || !password || !role) {
      return NextResponse.json(
        {
          success: false,
          message: "name, email, password and role are required.",
        },
        { status: 400 }
      );
    }

    // 5. Validate role
    if (!Object.values(ROLES).includes(role as PlatformRole)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid platform role.",
        },
        { status: 400 }
      );
    }

    // 6. Basic password validation
    if (password.length < 6) {
      return NextResponse.json(
        {
          success: false,
          message: "Password must be at least 6 characters.",
        },
        { status: 400 }
      );
    }

    const platformRole = role as PlatformRole;

    // 7. Generate default permissions from role
    const permissions = getDefaultPermissions(platformRole);

    // 8. Create Firebase Authentication user
    const authUser = await adminAuth.createUser({
      email,
      password,
      displayName: name,
    });

    try {
      // 9. Create platformUsers document
      const platformUserRef = adminDb
        .collection("platformUsers")
        .doc();

      await platformUserRef.set({
        name,
        email,
        role: platformRole,
        permissions,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: currentUser.authUid,
        authUid: authUser.uid,
      });

      // 10. Return safe response
      return NextResponse.json(
        {
          success: true,
          message: "Platform user created successfully.",
          user: {
            id: platformUserRef.id,
            authUid: authUser.uid,
            name,
            email,
            role: platformRole,
            active: true,
            permissions,
          },
        },
        { status: 201 }
      );
    } catch (firestoreError) {
      // Rollback Auth user if Firestore creation fails
      try {
        await adminAuth.deleteUser(authUser.uid);
      } catch (rollbackError) {
        console.error(
          "Failed to rollback Firebase Auth user:",
          rollbackError
        );
      }

      throw firestoreError;
    }
  } catch (error: unknown) {
    console.error("Create platform user error:", error);

    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? String((error as { code: unknown }).code)
        : "";

    if (errorCode === "auth/email-already-exists") {
      return NextResponse.json(
        {
          success: false,
          message: "A Firebase Authentication user with this email already exists.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Failed to create platform user.",
      },
      { status: 500 }
    );
  }
}
export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentPlatformUser();

    if (!currentUser) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 }
      );
    }

    if (currentUser.permissions?.manageUsers !== true) {
      return NextResponse.json(
        {
          success: false,
          message: "You do not have permission to manage users.",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const userId =
      typeof body.userId === "string" ? body.userId.trim() : "";

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          message: "userId is required.",
        },
        { status: 400 }
      );
    }

    const userRef = adminDb
      .collection("platformUsers")
      .doc(userId);

    const userSnapshot = await userRef.get();

    if (!userSnapshot.exists) {
      return NextResponse.json(
        {
          success: false,
          message: "User not found.",
        },
        { status: 404 }
      );
    }

    const existingUser = userSnapshot.data();

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
// Update password
if (body.password !== undefined) {
  if (
    typeof body.password !== "string" ||
    body.password.length < 6
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "Password must be at least 6 characters.",
      },
      { status: 400 }
    );
  }

  if (!existingUser?.authUid) {
    return NextResponse.json(
      {
        success: false,
        message: "User is not linked to Firebase Authentication.",
      },
      { status: 400 }
    );
  }

  await adminAuth.updateUser(existingUser.authUid, {
    password: body.password,
  });
}
    // Update name
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return NextResponse.json(
          {
            success: false,
            message: "Invalid name.",
          },
          { status: 400 }
        );
      }

      updates.name = body.name.trim();
    }

    // Update role
if (body.role !== undefined) {
  if (
    typeof body.role !== "string" ||
    !Object.values(ROLES).includes(
      body.role as PlatformRole
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "Invalid platform role.",
      },
      { status: 400 }
    );
  }

  const newRole = body.role as PlatformRole;

  updates.role = newRole;
  updates.permissions =
    getDefaultPermissions(newRole);
}

    // Update active status
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return NextResponse.json(
          {
            success: false,
            message: "active must be a boolean.",
          },
          { status: 400 }
        );
      }

      updates.active = body.active;
    }

    // Update individual permissions
    if (body.permissions !== undefined) {
      if (
        typeof body.permissions !== "object" ||
        body.permissions === null ||
        Array.isArray(body.permissions)
      ) {
        return NextResponse.json(
          {
            success: false,
            message: "permissions must be an object.",
          },
          { status: 400 }
        );
      }

      const defaultPermissions = getDefaultPermissions(
        (
          body.role ??
          existingUser?.role
        ) as PlatformRole
      );

      const incomingPermissions = body.permissions as Record<
        string,
        unknown
      >;

      const validatedPermissions: Record<
        string,
        boolean
      > = {
        ...defaultPermissions,
      };

      for (const permission of Object.keys(defaultPermissions)) {
        if (incomingPermissions[permission] !== undefined) {
          if (
            typeof incomingPermissions[permission] !==
            "boolean"
          ) {
            return NextResponse.json(
              {
                success: false,
                message: `Invalid value for permission: ${permission}`,
              },
              { status: 400 }
            );
          }

          validatedPermissions[permission] =
            incomingPermissions[permission] as boolean;
        }
      }

      updates.permissions = validatedPermissions;
    }

    await userRef.update(updates);

    const updatedSnapshot = await userRef.get();
    const updatedData = updatedSnapshot.data();

    return NextResponse.json({
      success: true,
      message: "Platform user updated successfully.",
      user: {
        id: userId,
        name: updatedData?.name ?? "",
        email: updatedData?.email ?? "",
        role: updatedData?.role ?? "",
        active: updatedData?.active === true,
        permissions: updatedData?.permissions ?? {},
      },
    });
  } catch (error) {
    console.error("Update platform user error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to update platform user.",
      },
      { status: 500 }
    );
  }
}