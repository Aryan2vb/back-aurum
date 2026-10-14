import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const pdfMake = require('pdfmake/build/pdfmake');
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const pdfFonts = require('pdfmake/build/vfs_fonts');
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const htmlToPdfmake = require('html-to-pdfmake');
import { JSDOM } from 'jsdom';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

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
   * Images that fail to fetch are removed so PDF generation never crashes.
   */
  private async inlineRemoteImages(html: string): Promise<string> {
    const imgSrcRegex = /<img\b[^>]*?\bsrc\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;

    const urls = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = imgSrcRegex.exec(html)) !== null) {
      urls.add(match[1]);
    }

    if (urls.size === 0) {
      return html;
    }

    // Fetch all unique remote images in parallel.
    const replacements = new Map<string, string | null>();
    await Promise.all(
      Array.from(urls).map(async (url) => {
        try {
          const dataUrl = await this.fetchAsDataUrl(url);
          replacements.set(url, dataUrl);
        } catch (err) {
          this.logger.warn(
            `Failed to fetch image for PDF, dropping it: ${url} (${(err as Error).message})`,
          );
          replacements.set(url, null);
        }
      }),
    );

    // Replace each <img ... src="url" ...> with either the dataURL or nothing.
    return html.replace(imgSrcRegex, (fullTag, url: string) => {
      const dataUrl = replacements.get(url);
      if (!dataUrl) {
        return '';
      }
      return fullTag.replace(url, dataUrl);
    });
  }

  private async fetchAsDataUrl(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType =
        response.headers.get('content-type')?.split(';')[0]?.trim() ||
        'image/png';

      const arrayBuffer = await response.arrayBuffer();
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
