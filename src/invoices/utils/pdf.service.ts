import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const pdfMake = require('pdfmake/build/pdfmake');
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const pdfFonts = require('pdfmake/build/vfs_fonts');
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const htmlToPdfmake = require('html-to-pdfmake');
import { JSDOM } from 'jsdom';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

/** Max bytes we will download for a single inlined image (guards against OOM). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Max time to wait for a single image fetch. */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Hostnames we are allowed to fetch inlined images from. Derived from the
   * configured public asset domain (R2_PUBLIC_URL). Only images served from
   * our own asset host are inlined — this prevents SSRF via attacker-influenced
   * image URLs (e.g. cloud metadata endpoints or internal services).
   */
  private readonly allowedImageHosts: Set<string>;

  constructor(private readonly config: ConfigService) {
    const hosts = new Set<string>();
    const publicUrl = this.config.get<string>('R2_PUBLIC_URL');
    if (publicUrl) {
      try {
        hosts.add(new URL(publicUrl).hostname.toLowerCase());
      } catch {
        this.logger.warn(`R2_PUBLIC_URL is not a valid URL: ${publicUrl}`);
      }
    }
    this.allowedImageHosts = hosts;
  }

  async generatePdf(html: string): Promise<Buffer> {
    this.logger.debug('Generating PDF using pdfmake');

    try {
      // Pre-process HTML to remove "heavy" CSS that causes pdfmake/html-to-pdfmake to hang
      // Especially gradients, grid, and complex flexbox
      let sanitizedHtml = this.sanitizeForPdf(html);

      // pdfmake (in Node) cannot resolve remote image URLs — it only accepts
      // dataURLs or local/VFS paths. Fetch any remote <img> sources and inline
      // them as base64 dataURLs before converting.
      sanitizedHtml = await this.inlineRemoteImages(sanitizedHtml);

      const { window } = new JSDOM('');
      const parsedHtml = htmlToPdfmake(sanitizedHtml, { window });

      const docDefinition = {
        content: parsedHtml,
        pageMargins: [28, 28, 28, 28] as [number, number, number, number],
        defaultStyle: {
          font: 'Roboto',
        },
      };

      const pdfDocGenerator = pdfMake.createPdf(docDefinition);

      // Ensure we don't hang indefinitely if pdfmake fails internally
      return new Promise<Buffer>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('PDF generation timed out after 30s'));
        }, 30000);

        try {
          pdfDocGenerator.getBuffer((buffer: Uint8Array) => {
            clearTimeout(timeout);
            this.logger.debug('PDF generated successfully with pdfmake');
            resolve(Buffer.from(buffer));
          });
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    } catch (error) {
      this.logger.error('Failed to generate PDF with pdfmake', error);
      throw error;
    }
  }

  /**
   * Finds remote image URLs in <img src="..."> attributes, fetches them, and
   * replaces the src with a base64 dataURL so pdfmake can render them.
   * Images that fail to fetch, exceed the size cap, or are not served from an
   * allowed host are removed so PDF generation never crashes.
   */
  private async inlineRemoteImages(html: string): Promise<string> {
    // A fresh regex per call site avoids sharing a stateful (/g) lastIndex
    // between the discovery pass and the replace pass.
    const discoverRegex = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;

    const urls = new Set<string>();
    for (const match of html.matchAll(discoverRegex)) {
      urls.add(match[1]);
    }

    if (urls.size === 0) {
      return html;
    }

    // Fetch all unique, allowlisted remote images in parallel.
    const replacements = new Map<string, string | null>();
    await Promise.all(
      Array.from(urls).map(async (url) => {
        if (!this.isAllowedImageUrl(url)) {
          this.logger.warn(`Refusing to inline image from disallowed host: ${url}`);
          replacements.set(url, null);
          return;
        }
        try {
          replacements.set(url, await this.fetchAsDataUrl(url));
        } catch (err) {
          this.logger.warn(
            `Failed to fetch image for PDF, dropping it: ${url} (${(err as Error).message})`,
          );
          replacements.set(url, null);
        }
      }),
    );

    // Replace each <img ... src="url" ...> with either the dataURL or nothing.
    const replaceRegex = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    return html.replace(replaceRegex, (fullTag, url: string) => {
      const dataUrl = replacements.get(url);
      if (!dataUrl) {
        return '';
      }
      return fullTag.replace(url, dataUrl);
    });
  }

  /**
   * SSRF guard: only allow fetching images from configured asset hosts. Any URL
   * that fails to parse, uses a non-http(s) scheme, or targets a host outside
   * the allowlist is rejected.
   */
  private isAllowedImageUrl(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    return this.allowedImageHosts.has(parsed.hostname.toLowerCase());
  }

  private async fetchAsDataUrl(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Reject early if the server advertises a body larger than our cap.
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        throw new Error(`image too large (${declaredLength} bytes > ${MAX_IMAGE_BYTES})`);
      }

      const contentType =
        response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';

      const arrayBuffer = await response.arrayBuffer();
      // Enforce the cap again against the actual body (servers may lie or omit
      // content-length, e.g. chunked transfer encoding).
      if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`image too large (${arrayBuffer.byteLength} bytes > ${MAX_IMAGE_BYTES})`);
      }

      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return `data:${contentType};base64,${base64}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  private sanitizeForPdf(html: string): string {
    // Remove complex CSS that hangs html-to-pdfmake
    return html
      .replace(/background:\s*linear-gradient\([^)]+\);?/gi, '')
      .replace(/display:\s*(grid|flex);?/gi, 'display: block;')
      .replace(/grid-template-columns:[^;]+;?/gi, '')
      .replace(/gap:[^;]+;?/gi, '')
      .replace(/box-shadow:[^;]+;?/gi, '')
      .replace(/filter:[^;]+;?/gi, '')
      .replace(/backdrop-filter:[^;]+;?/gi, '');
  }
}
