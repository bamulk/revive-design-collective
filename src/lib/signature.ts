// Thin wrapper over https://signatureapi.com
//
// Docs: POST https://api.signatureapi.com/v1/envelopes with X-API-Key header.
// An envelope is one or more documents + recipients + placement markers for
// signature fields. The API fetches the `url` we pass, renders it, emails the
// recipient a signing link, and calls our webhook as status changes.

const BASE_URL = "https://api.signatureapi.com/v1";

export function isSignatureConfigured(): boolean {
  return !!process.env.SIGNATURE_API_KEY;
}

type CreateEnvelopeInput = {
  title: string;
  /** Publicly-fetchable URL of the PDF to sign. */
  documentUrl: string;
  recipient: {
    name: string;
    email: string;
  };
  /**
   * Optional second signer. When set, BOTH signers must complete their
   * signature for the envelope to finalize. A second signature field is
   * placed at `secondaryPosition` and addressed to a separate
   * recipient_key so each signer gets their own signing link.
   */
  secondaryRecipient?: {
    name: string;
    email: string;
  };
  /**
   * The `key` of the signature field. Used internally by SignatureAPI;
   * doesn't need to appear in the PDF when we supply a fixed position.
   */
  signaturePlaceKey?: string;
  /**
   * Fixed position on the document, in PDF points. `page` is 1-indexed;
   * `top` is measured from the TOP edge of the page (not the bottom).
   * Documented at
   * https://signatureapi.com/docs/api/resources/places/positioning
   * When omitted, SignatureAPI expects an inline `[[place_key]]` marker
   * in the PDF text.
   */
  position?: {
    page: number;
    top: number;
    left: number;
  };
  /** Position for the secondary signer's signature field. */
  secondaryPosition?: {
    page: number;
    top: number;
    left: number;
  };
  /** Fixed position for a REQUIRED initials place (client) — used for
   *  the contract's Additional Fees acknowledgement. */
  initialsPosition?: {
    page: number;
    top: number;
    left: number;
  };
  /** Initials place for the secondary signer. */
  secondaryInitialsPosition?: {
    page: number;
    top: number;
    left: number;
  };
};

export type EnvelopeResponse = {
  id: string;
  status?: string;
  [k: string]: unknown;
};

export async function createEnvelope(
  input: CreateEnvelopeInput
): Promise<EnvelopeResponse> {
  const apiKey = process.env.SIGNATURE_API_KEY;
  if (!apiKey) throw new Error("SIGNATURE_API_KEY not configured");

  const placeKey = input.signaturePlaceKey || "client_signature";
  const secondaryPlaceKey = "secondary_signature";
  const hasSecondary = !!input.secondaryRecipient;

  const places: Array<Record<string, unknown>> = [
    { key: placeKey, type: "signature", recipient_key: "client" },
  ];
  if (hasSecondary) {
    places.push({
      key: secondaryPlaceKey,
      type: "signature",
      recipient_key: "secondary",
    });
  }

  const fixedPositions: Array<Record<string, unknown>> = [];
  if (input.position) {
    fixedPositions.push({
      place_key: placeKey,
      page: input.position.page,
      top: input.position.top,
      left: input.position.left,
    });
  }
  if (hasSecondary && input.secondaryPosition) {
    fixedPositions.push({
      place_key: secondaryPlaceKey,
      page: input.secondaryPosition.page,
      top: input.secondaryPosition.top,
      left: input.secondaryPosition.left,
    });
  }

  // Initials places (Additional Fees acknowledgement). Every place on
  // an envelope must be completed by its recipient, so these are
  // effectively required initials.
  if (input.initialsPosition) {
    places.push({ key: "client_initials", type: "initials", recipient_key: "client" });
    // Explicit size: SignatureAPI anchors the BOTTOM-LEFT corner at
    // `top` and draws the box upward; the default 60pt-tall box would
    // paint over the fee clause the initials acknowledge.
    fixedPositions.push({
      place_key: "client_initials",
      page: input.initialsPosition.page,
      top: input.initialsPosition.top,
      left: input.initialsPosition.left,
      width: 90,
      height: 24,
    });
  }
  if (hasSecondary && input.secondaryInitialsPosition) {
    places.push({ key: "secondary_initials", type: "initials", recipient_key: "secondary" });
    fixedPositions.push({
      place_key: "secondary_initials",
      page: input.secondaryInitialsPosition.page,
      top: input.secondaryInitialsPosition.top,
      left: input.secondaryInitialsPosition.left,
      width: 90,
      height: 24,
    });
  }

  const document: Record<string, unknown> = {
    format: "pdf",
    url: input.documentUrl,
    places,
    ...(fixedPositions.length > 0 ? { fixed_positions: fixedPositions } : {}),
  };

  const recipients: Array<Record<string, unknown>> = [
    {
      type: "signer",
      key: "client",
      name: input.recipient.name,
      email: input.recipient.email,
    },
  ];
  if (hasSecondary) {
    recipients.push({
      type: "signer",
      key: "secondary",
      name: input.secondaryRecipient!.name,
      email: input.secondaryRecipient!.email,
    });
  }

  const body: Record<string, unknown> = {
    title: input.title,
    documents: [document],
    recipients,
    // Multi-signer envelopes default to "sequential" routing — the
    // second signer doesn't get their email until the first one signs.
    // For our split-payment use case both should be notified
    // simultaneously and can sign in any order.
    ...(hasSecondary ? { routing: "parallel" } : {}),
  };

  const res = await fetch(`${BASE_URL}/envelopes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SignatureAPI ${res.status}: ${text}`);
  }

  return (await res.json()) as EnvelopeResponse;
}

/**
 * Re-delivers the signing-request email for an existing recipient
 * without creating a new envelope. Rate-limited by SignatureAPI; the
 * response includes `can_resend_at` showing when another attempt is
 * allowed. Throws with the API's error message on failure (including
 * rate-limit responses) so the caller can surface it to the user.
 */
export async function resendRecipient(recipientId: string): Promise<void> {
  const apiKey = process.env.SIGNATURE_API_KEY;
  if (!apiKey) throw new Error("SIGNATURE_API_KEY not configured");

  const res = await fetch(`${BASE_URL}/recipients/${recipientId}/resend`, {
    method: "POST",
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`SignatureAPI resend ${res.status}: ${await res.text()}`);
  }
}

export async function getEnvelope(envelopeId: string): Promise<EnvelopeResponse> {
  const apiKey = process.env.SIGNATURE_API_KEY;
  if (!apiKey) throw new Error("SIGNATURE_API_KEY not configured");

  const res = await fetch(`${BASE_URL}/envelopes/${envelopeId}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`SignatureAPI GET ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as EnvelopeResponse;
}

/**
 * Download the signed deliverable PDF for a completed envelope.
 *
 * SignatureAPI splits this into three calls:
 *   1. GET /v1/envelopes/{envelope_id}/deliverables   → list of deliverables
 *   2. Each deliverable has a `url` once `status === "generated"`. If not
 *      present in the list payload, fetch the full deliverable object via
 *      GET /v1/deliverables/{id}.
 *   3. GET that url            → the actual PDF bytes (presigned, no auth)
 *
 * Returns null if no generated deliverable exists yet (e.g. envelope is
 * still being finalized after signing). Callers should re-attempt later.
 */
export async function downloadSignedPdf(
  envelopeId: string
): Promise<Uint8Array | null> {
  const apiKey = process.env.SIGNATURE_API_KEY;
  if (!apiKey) throw new Error("SIGNATURE_API_KEY not configured");

  // 1. List deliverables for this envelope.
  const listRes = await fetch(
    `${BASE_URL}/envelopes/${envelopeId}/deliverables`,
    { headers: { "X-API-Key": apiKey } }
  );
  if (!listRes.ok) {
    console.warn(
      "downloadSignedPdf: list deliverables",
      listRes.status,
      await listRes.text()
    );
    return null;
  }
  const list = (await listRes.json()) as {
    data?: { id?: string; status?: string; url?: string | null }[];
  };
  const deliverables = list.data ?? [];
  if (deliverables.length === 0) return null;

  // Prefer one that's already generated, otherwise take whatever's first
  // and we'll re-resolve via GET.
  const candidate =
    deliverables.find((d) => d.status === "generated" && d.url) ||
    deliverables.find((d) => d.id);
  if (!candidate?.id) return null;

  // 2. Resolve the download URL.
  let downloadUrl: string | null = candidate.url ?? null;
  if (!downloadUrl) {
    const detRes = await fetch(`${BASE_URL}/deliverables/${candidate.id}`, {
      headers: { "X-API-Key": apiKey },
    });
    if (!detRes.ok) return null;
    const det = (await detRes.json()) as { url?: string | null };
    downloadUrl = det.url ?? null;
  }
  if (!downloadUrl) return null;

  // 3. Fetch the actual PDF bytes from the (usually pre-signed) URL.
  const pdfRes = await fetch(downloadUrl);
  if (!pdfRes.ok) {
    console.warn(
      "downloadSignedPdf: PDF fetch",
      pdfRes.status,
      pdfRes.headers.get("content-type")
    );
    return null;
  }
  return new Uint8Array(await pdfRes.arrayBuffer());
}
