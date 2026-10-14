import { ConfigService } from '@nestjs/config';

// The real pdfmake/jsdom chain pulls in ESM-only transitive deps that Jest does
// not transform. We only test the image-inlining logic, which does not touch
// these, so stub them out before importing the service under test.
jest.mock('pdfmake/build/pdfmake', () => ({ vfs: {}, createPdf: jest.fn() }), { virtual: true });
jest.mock('pdfmake/build/vfs_fonts', () => ({ pdfMake: { vfs: {} } }), { virtual: true });
jest.mock('html-to-pdfmake', () => jest.fn(), { virtual: true });
jest.mock('jsdom', () => ({ JSDOM: jest.fn() }));

import { PdfService } from './pdf.service';

/**
 * These tests exercise the remote-image inlining security controls:
 *  - SSRF allowlist (only R2_PUBLIC_URL host may be fetched)
 *  - response size cap (OOM guard)
 *  - stateless regex handling across multiple <img> tags
 *
 * inlineRemoteImages is private; we invoke it via a typed cast since its
 * security behavior is the whole point of the test.
 */
describe('PdfService.inlineRemoteImages', () => {
  const ALLOWED_HOST = 'assets.sarafa-bazar.com';
  let service: PdfService;
  let fetchMock: jest.Mock;

  const makeService = (publicUrl?: string): PdfService => {
    const config = {
      get: (key: string) => (key === 'R2_PUBLIC_URL' ? publicUrl : undefined),
    } as unknown as ConfigService;
    return new PdfService(config);
  };

  // Helper to reach the private method in a type-safe-ish way.
  const inline = (svc: PdfService, html: string): Promise<string> =>
    (svc as unknown as { inlineRemoteImages(h: string): Promise<string> }).inlineRemoteImages(html);

  const pngResponse = (bytes = 4, contentLength?: number): Response =>
    ({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => {
          const key = h.toLowerCase();
          if (key === 'content-type') return 'image/png';
          if (key === 'content-length') return String(contentLength ?? bytes);
          return null;
        },
      },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }) as unknown as Response;

  beforeEach(() => {
    service = makeService(`https://${ALLOWED_HOST}`);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inlines an image served from the allowed host', async () => {
    fetchMock.mockResolvedValue(pngResponse(4));
    const html = `<img src="https://${ALLOWED_HOST}/logo.png">`;
    const out = await inline(service, html);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toContain(`https://${ALLOWED_HOST}/logo.png`);
  });

  it('refuses to fetch a disallowed host (SSRF guard) and drops the img', async () => {
    const html = `<img src="http://169.254.169.254/latest/meta-data/">`;
    const out = await inline(service, html);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toBe('');
  });

  it('refuses an off-allowlist public host', async () => {
    const html = `<img src="https://evil.example.com/x.png">`;
    const out = await inline(service, html);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toBe('');
  });

  it('drops images that exceed the size cap via content-length', async () => {
    fetchMock.mockResolvedValue(pngResponse(4, 20 * 1024 * 1024));
    const html = `<img src="https://${ALLOWED_HOST}/huge.png">`;
    const out = await inline(service, html);

    expect(out).toBe('');
  });

  it('drops images that exceed the size cap via actual body length', async () => {
    // content-length omitted/small, but the real body is huge.
    fetchMock.mockResolvedValue(pngResponse(20 * 1024 * 1024, 1));
    const html = `<img src="https://${ALLOWED_HOST}/huge.png">`;
    const out = await inline(service, html);

    expect(out).toBe('');
  });

  it('handles multiple img tags without stateful-regex corruption', async () => {
    fetchMock.mockResolvedValue(pngResponse(4));
    const html =
      `<img src="https://${ALLOWED_HOST}/a.png">` +
      `<p>between</p>` +
      `<img src="https://${ALLOWED_HOST}/b.png">`;
    const out = await inline(service, html);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.match(/data:image\/png;base64,/g)?.length).toBe(2);
    expect(out).toContain('<p>between</p>');
  });

  it('is a no-op when there are no remote images', async () => {
    const html = `<p>no images here</p>`;
    const out = await inline(service, html);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toBe(html);
  });

  it('drops all images when no allowed host is configured', async () => {
    const noConfigService = makeService(undefined);
    const html = `<img src="https://${ALLOWED_HOST}/logo.png">`;
    const out = await inline(noConfigService, html);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toBe('');
  });
});
