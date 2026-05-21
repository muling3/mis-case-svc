// End-to-end test driver for the document-upload + Sandbox-scan workflow.
//
// Purpose: from a case, submit a deliberately MALICIOUS payload (the EICAR
// anti-malware test string — every AV engine recognises it) through the
// Document Service, watch it be quarantined, scanned, rejected, and observe
// the rejection email land in MailDev (http://localhost:1080). The full
// end-to-end flow this exercises is documented in
// architecture/document-upload-workflow.md.
//
// Mounted at /api/cases/test-upload (whitelisted in main.ts so the access
// guard skips the case:read check, since the PoC token may not carry it).

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

const SERVICE = 'mis-case-service';

// EICAR test string — a 68-byte payload that EVERY AV engine flags as
// malicious by convention. Not actually malicious. RFC: https://www.eicar.org
// We assemble it from fragments so this source file itself doesn't trip an
// on-save AV scanner on a developer laptop.
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}' +
  '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!' +
  '$H+H*';

interface TestUploadBody {
  caseId?: string;
  notifyEmail?: string;
  filename?: string;
}

interface DocumentStatusResponse {
  document_id: string;
  // Coarse state. SCANNING is the umbrella while scan_stage progresses.
  tracking_status: string;
  // Business-view status (mongo.documents.doc_status).
  doc_status?: string;
  // Sub-stage while tracking_status=SCANNING. One of:
  // submitted | cuckoo | clamav | yara | suricata | aggregating | done.
  scan_stage?: string | null;
  // 0–100, set by the Document Service consumer of mis.documents.scan-progress.
  progress_pct?: number;
  verdict?: {
    verdict: 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS' | 'INCONCLUSIVE';
    cuckoo_task_id?: string;
    scanner_results?: Array<{ name: string; status: string; evidence?: string[] }>;
  };
}

@Controller('test-upload')
export class TestUploadController {
  // Pulled from env in a real service; literal defaults make the PoC
  // self-contained against the docker-compose stack.
  private readonly documentBase =
    process.env.DOCUMENT_SERVICE_URL ?? 'http://localhost:3007';

  /**
   * Drives the full end-to-end MALICIOUS-verdict flow.
   *
   *   POST /api/cases/test-upload
   *   { "caseId": "case_demo_1", "notifyEmail": "officer@example.com" }
   *
   * Returns the document_id so the caller can poll
   *   GET /api/cases/test-upload/status/:documentId
   * until status = REJECTED_MALICIOUS, then open http://localhost:1080
   * to see the captured rejection email.
   */
  @Post()
  async submit(@Body() body: TestUploadBody, @Req() req: any) {
    const caseId = body.caseId ?? `case_${Date.now()}`;
    const notifyEmail = body.notifyEmail ?? 'officer@example.com';
    const filename = body.filename ?? 'eicar-test.txt';
    const correlationId = req.correlationId ?? cryptoRandomId();

    // Build a multipart body without bringing in form-data — keeps the
    // PoC dependency-free. We embed the EICAR string as a text/plain part.
    const boundary = `----mis${cryptoRandomId()}`;
    const metadata = {
      parent_type: 'case',
      parent_ref: caseId,
      doc_type: 'evidence',
      submitted_by: req.user?.id ?? 'test-runner',
      notify_email: notifyEmail,
    };
    const parts = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="metadata"',
      'Content-Type: application/json',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: text/plain',
      '',
      EICAR,
      `--${boundary}--`,
      '',
    ];
    const payload = parts.join('\r\n');

    const res = await fetch(`${this.documentBase}/api/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-Correlation-ID': correlationId,
        'Idempotency-Key': `test-${caseId}-${correlationId}`,
        Authorization: req.headers?.authorization ?? '',
      },
      body: payload,
    });

    if (res.status !== 202) {
      const text = await res.text().catch(() => '');
      throw new HttpException(
        {
          message: 'document-service did not accept the submission',
          upstreamStatus: res.status,
          upstreamBody: text.slice(0, 500),
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const accepted = (await res.json()) as { document_id: string; status_url?: string };
    return {
      service: SERVICE,
      caseId,
      correlationId,
      document_id: accepted.document_id,
      expected_verdict: 'MALICIOUS (EICAR test string)',
      next_steps: [
        `GET /api/cases/test-upload/status/${accepted.document_id}`,
        'Open MailDev at http://localhost:1080 once status=REJECTED_MALICIOUS',
        'See architecture/document-upload-workflow.md §10 for the trace',
      ],
    };
  }

  /**
   * Convenience proxy to the Document Service status endpoint, so a tester
   * doesn't have to remember which port the document service is on.
   */
  @Get('status/:documentId')
  async status(@Param('documentId') documentId: string, @Req() req: any) {
    const res = await fetch(
      `${this.documentBase}/api/documents/${documentId}/status`,
      {
        headers: { Authorization: req.headers?.authorization ?? '' },
      },
    );
    if (!res.ok) {
      throw new HttpException(
        { upstreamStatus: res.status },
        HttpStatus.BAD_GATEWAY,
      );
    }
    const upstream = (await res.json()) as DocumentStatusResponse;

    // Friendly human-readable progress line while we're still SCANNING — this
    // is what a UI / curl-loop tester will most want to see tick over.
    const progress =
      upstream.tracking_status === 'SCANNING'
        ? `scanning: ${upstream.scan_stage ?? 'submitted'} (${upstream.progress_pct ?? 0}%)`
        : upstream.tracking_status;

    return {
      service: SERVICE,
      ...upstream,
      progress,
      maildev_url:
        upstream.tracking_status === 'REJECTED_MALICIOUS'
          ? 'http://localhost:1080'
          : undefined,
    };
  }
}

function cryptoRandomId(): string {
  // 16 hex chars — enough for a correlation id in a PoC, no dep on node:crypto
  // typing quirks under the project's ES2023 target.
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}
