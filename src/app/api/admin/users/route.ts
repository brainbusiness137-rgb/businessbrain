import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  getCurrentPlatformUser,
} from "@/lib/auth";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  canActorGrantPermission,
  canAssignPlatformRole,
  canManagePlatformUser,
  canModifyPlatformPermissions,
  canModifyPlatformRole,
  getGrantableDefaultPermissions,
  hasPlatformAuthority,
  isPermission,
  isPermissionWithinRoleCeiling,
  isPlatformRole,
  PERMISSIONS,
  ROLES,
  Permission,
} from "@/lib/permissions";

const OWNER_CRITICAL_PERMISSIONS: Permission[] = [
  PERMISSIONS.manageUsers,
  PERMISSIONS.manageRoles,
  PERMISSIONS.managePermissions,
];

function forbidden(message: string) {
  return NextResponse.json(
    { success: false, message },
    { status: 403 }
  );
}

async function isLastActiveOwner(userId: string): Promise<boolean> {
  const snapshot = await adminDb
    .collection("platformUsers")
    .where("role", "==", ROLES.platform_owner)
    .where("active", "==", true)
    .get();

  return (
    snapshot.docs.some((doc) => doc.id === userId) &&
    snapshot.size <= 1
  );
}

function normalizePermissions(
  permissions: Record<string, unknown> | undefined
): Record<Permission, boolean> {
  return Object.fromEntries(
    Object.values(PERMISSIONS).map((permission) => [
      permission,
      permissions?.[permission] === true,
    ])
  ) as Record<Permission, boolean>;
}

function permissionsEqual(
  left: Record<Permission, boolean>,
  right: Record<Permission, boolean>
): boolean {
  return Object.values(PERMISSIONS).every(
    (permission) => left[permission] === right[permission]
  );
}
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

    if (!hasPlatformAuthority(currentUser, PERMISSIONS.manageUsers)) {
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
        permissions: data.permissions || {},
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
    if (!hasPlatformAuthority(currentUser, PERMISSIONS.manageUsers)) {
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
    if (!isPlatformRole(role)) {
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

    const platformRole = role;

    if (!canAssignPlatformRole(currentUser, platformRole)) {
      return forbidden(
        "You are not authorized to assign this platform role. Platform ownership requires the dedicated ownership transfer workflow."
      );
    }

    if (body.permissions !== undefined) {
      return NextResponse.json(
        {
          success: false,
          message: "Individual permissions cannot be supplied during platform user creation.",
        },
        { status: 400 }
      );
    }

    // 7. Generate default permissions from role
    const permissions = getGrantableDefaultPermissions(
      currentUser,
      platformRole
    );

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

    if (!hasPlatformAuthority(currentUser, PERMISSIONS.manageUsers)) {
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

    if (!isPlatformRole(existingUser?.role)) {
      return NextResponse.json(
        {
          success: false,
          message: "The target user has an invalid platform role.",
        },
        { status: 409 }
      );
    }

    const existingRole = existingUser.role;
    const isSelf = currentUser.id === userId;
    const isOwnerTarget = existingRole === ROLES.platform_owner;

    if (isOwnerTarget && !isSelf) {
      return forbidden(
        "Platform owners cannot be modified through ordinary user management."
      );
    }

    if (!isOwnerTarget && !canManagePlatformUser(currentUser, existingRole)) {
      return forbidden("You are not authorized to manage this platform user.");
    }

    if (isOwnerTarget && currentUser.role !== ROLES.platform_owner) {
      return forbidden("Only a platform owner may modify their own account.");
    }

    const requestedRole = body.role ?? existingRole;

    if (!isPlatformRole(requestedRole)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid platform role.",
        },
        { status: 400 }
      );
    }

    const roleChanged = requestedRole !== existingRole;

    if (roleChanged) {
      if (isOwnerTarget || requestedRole === ROLES.platform_owner) {
        return forbidden(
          "Platform ownership cannot be created, transferred, or removed through ordinary user management."
        );
      }

      if (!canModifyPlatformRole(currentUser, existingRole, requestedRole)) {
        return forbidden(
          "Changing a platform role requires manageRoles and sufficient role authority."
        );
      }
    }

    if (
      isOwnerTarget &&
      body.active === false
    ) {
      if (await isLastActiveOwner(userId)) {
        return forbidden("The last active platform owner cannot be deactivated.");
      }

      return forbidden(
        "A platform owner cannot deactivate their account through ordinary user management."
      );
    }

    const updates: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Validate password before any external mutation. The Auth update occurs
    // only after every role/permission/owner policy check has passed.
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

      const incomingPermissions = body.permissions as Record<
        string,
        unknown
      >;

      for (const permissionKey of Object.keys(incomingPermissions)) {
        if (!isPermission(permissionKey)) {
          return NextResponse.json(
            {
              success: false,
              message: `Unknown platform permission: ${permissionKey}`,
            },
            { status: 400 }
          );
        }

        const value = incomingPermissions[permissionKey];

        if (typeof value !== "boolean") {
          return NextResponse.json(
            {
              success: false,
              message: `Invalid value for permission: ${permissionKey}`,
            },
            { status: 400 }
          );
        }
      }
    }

    const currentPermissions = normalizePermissions(
      existingUser.permissions as Record<string, unknown> | undefined
    );
    const roleDefaultPermissions = roleChanged
      ? getGrantableDefaultPermissions(
          currentUser,
          requestedRole,
          currentPermissions
        )
      : currentPermissions;
    const requestedPermissions = {
      ...roleDefaultPermissions,
    };
    let individualPermissionsChanged = false;

    if (body.permissions !== undefined) {
      const incomingPermissions = body.permissions as Record<
        string,
        boolean
      >;

      for (const permissionKey of Object.keys(incomingPermissions)) {
        requestedPermissions[permissionKey as Permission] =
          incomingPermissions[permissionKey];
      }

      individualPermissionsChanged = !permissionsEqual(
        requestedPermissions,
        roleDefaultPermissions
      );

      if (individualPermissionsChanged) {
        if (!canModifyPlatformPermissions(currentUser, existingRole)) {
          if (!isOwnerTarget || !isSelf) {
            return forbidden(
              "Changing individual permissions requires managePermissions and authority over the target user."
            );
          }

          if (
            !hasPlatformAuthority(
              currentUser,
              PERMISSIONS.managePermissions
            )
          ) {
            return forbidden(
              "Changing individual permissions requires managePermissions."
            );
          }
        }

        for (const permission of Object.values(PERMISSIONS)) {
          if (
            requestedPermissions[permission] &&
            !isPermissionWithinRoleCeiling(requestedRole, permission)
          ) {
            return forbidden(
              `Permission ${permission} exceeds the ${requestedRole} role ceiling.`
            );
          }

          const becomesGranted =
            requestedPermissions[permission] &&
            currentPermissions[permission] !== true;

          if (
            becomesGranted &&
            !canActorGrantPermission(currentUser, permission)
          ) {
            return forbidden(
              `You are not authorized to grant permission: ${permission}`
            );
          }
        }

        if (isOwnerTarget) {
          const removesCriticalOwnerAuthority =
            OWNER_CRITICAL_PERMISSIONS.some(
              (permission) =>
                currentPermissions[permission] === true &&
                requestedPermissions[permission] !== true
            );

          if (removesCriticalOwnerAuthority) {
            return forbidden(
              "Critical platform owner authority cannot be removed through ordinary user management."
            );
          }
        }
      }
    }

    if (roleChanged) {
      updates.role = requestedRole;
    }

    if (roleChanged || individualPermissionsChanged) {
      updates.permissions = requestedPermissions;
    }

    if (body.password !== undefined) {
      await adminAuth.updateUser(existingUser.authUid, {
        password: body.password,
      });
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
