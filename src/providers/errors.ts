function readProviderError(body: string): string {
  const text = body.trim();
  try {
    const payload = JSON.parse(text);
    const detail = payload?.error?.message ?? payload?.error ?? payload?.message;
    if (typeof detail === 'string') return detail.trim();
  } catch {
    // Some providers return plain text.
  }

  return text;
}

function redactError(detail: string, secret?: string): string {
  const sanitized = secret ? detail.split(secret).join('[redacted]') : detail;
  return sanitized.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 400);
}

export function describeStreamError(provider: string, error: unknown, secret?: string): string {
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Request failed';
  return [provider + ' request failed.', redactError(detail, secret)].filter(Boolean).join(' ');
}

export async function describeHttpError(provider: string, response: Response, secret?: string): Promise<string> {
  const detail = readProviderError(await response.text());
  return [`${provider} returned HTTP ${response.status}.`, redactError(detail, secret)].filter(Boolean).join(' ');
}
