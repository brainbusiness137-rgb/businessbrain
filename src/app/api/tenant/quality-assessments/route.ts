import { NextResponse } from "next/server";
import { requireGuidedActor, GuidedAccessError } from "@/lib/guided-authorization";
import { requireProcedureActor, requireProcedureReadAccess, ProcedureAccessError } from "@/lib/procedure-authorization";
import { assessCandidate, assessDiscovery, assessProcedure } from "@/lib/quality-engine";
import { localizeAssessment } from "@/lib/quality-localization";
import { loadCandidateQualityContext, loadDiscoveryQualityContext, loadProcedureForQuality, loadProcedureQualityContext, QualityDataError } from "@/lib/quality-store";
import { isValidFirestoreDocumentId } from "@/lib/request-validation";
import { TenantAccessError } from "@/lib/tenant-auth";

const noStore = { "Cache-Control": "private, no-store" };
function error(error: unknown) { if (error instanceof GuidedAccessError || error instanceof ProcedureAccessError || error instanceof TenantAccessError || error instanceof QualityDataError) return NextResponse.json({ success: false, message: error.message }, { status: error.status, headers: noStore }); console.error("Quality assessment failed:", error); return NextResponse.json({ success: false, message: "Quality assessment failed." }, { status: 500, headers: noStore }); }
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams; const keys = [...params.keys()];
    if (keys.some((key) => !["sessionId", "candidateId", "procedureId"].includes(key)) || ["sessionId", "candidateId", "procedureId"].some((key) => params.getAll(key).length > 1)) throw new QualityDataError("Invalid quality-assessment query.", 400);
    const sessionId = params.get("sessionId"); const candidateId = params.get("candidateId"); const procedureId = params.get("procedureId");
    const sessionContract = Boolean(sessionId && !procedureId); const procedureContract = Boolean(procedureId && !sessionId && !candidateId);
    if ((!sessionContract && !procedureContract) || candidateId && !sessionId || [sessionId, candidateId, procedureId].some((id) => id !== null && !isValidFirestoreDocumentId(id))) throw new QualityDataError("Invalid quality-assessment query.", 400);
    let assessment;
    if (procedureId) { const actor = await requireProcedureActor(); const procedure = await loadProcedureForQuality(procedureId); try { await requireProcedureReadAccess(procedure, actor); } catch (reason) { if (reason instanceof ProcedureAccessError || reason instanceof TenantAccessError) throw new QualityDataError("Procedure not found.", 404); throw reason; } assessment = assessProcedure(await loadProcedureQualityContext(procedure)); }
    else { const actor = await requireGuidedActor(); assessment = candidateId ? assessCandidate(await loadCandidateQualityContext(sessionId!, candidateId, actor)) : assessDiscovery(await loadDiscoveryQualityContext(sessionId!, actor)); }
    return NextResponse.json({ success: true, assessment: localizeAssessment(assessment, "ar") }, { headers: noStore });
  } catch (reason) { return error(reason); }
}
