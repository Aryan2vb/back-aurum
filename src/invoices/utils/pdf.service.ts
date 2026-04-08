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
      const sanitizedHtml = this.sanitizeForPdf(html);

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
