import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfMake = require('pdfmake/build/pdfmake');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfFonts = require('pdfmake/build/vfs_fonts');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const htmlToPdfmake = require('html-to-pdfmake');
import { JSDOM } from 'jsdom';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

@Injectable()
export class PdfService {
    private readonly logger = new Logger(PdfService.name);

    async generatePdf(html: string): Promise<Buffer> {
        this.logger.debug('Generating PDF replacing Puppeteer with pdfmake');
        
        try {
            const { window } = new JSDOM('');
            const parsedHtml = htmlToPdfmake(html, { window });

            const docDefinition = {
                content: parsedHtml,
                pageMargins: [28, 28, 28, 28] as [number, number, number, number], // roughly 10mm
                defaultStyle: {
                    font: 'Roboto'
                }
            };

            const pdfDocGenerator = pdfMake.createPdf(docDefinition);
            return new Promise<Buffer>((resolve, reject) => {
                pdfDocGenerator.getBuffer((buffer: Uint8Array) => {
                    this.logger.debug('PDF generated successfully with pdfmake');
                    resolve(Buffer.from(buffer)); // Ensure it's a native Node Buffer
                });
            });
        } catch (error) {
            this.logger.error('Failed to generate PDF with pdfmake', error);
            throw error;
        }
    }
}
