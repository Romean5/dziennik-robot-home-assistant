'use client';

import { useEffect, useRef, useState } from 'react';

type Props = { blob: Blob; language: 'pl' | 'da' | 'en' | 'lt' };

/**
 * A PDF preview rendered on canvases rather than delegated to the phone's
 * browser PDF viewer. Some Android browsers block blob: tabs or do not embed
 * PDFs in an iframe, whereas canvas works consistently in the app itself.
 */
export default function PdfPreview({ blob, language }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    setFallbackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => Promise<void>) | undefined;
    setFailed(false);
    setReady(false);
    const root = container.current;
    if (root) root.replaceChildren();

    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        destroy = () => task.destroy();
        const document = await task.promise;
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          if (cancelled || !root) return;
          const page = await document.getPage(pageNumber);
          const viewport = page.getViewport({ scale: 1.35 });
          const scale = Math.min(window.devicePixelRatio || 1, 2);
          const canvas = window.document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) throw new Error('canvas_unavailable');
          canvas.width = Math.ceil(viewport.width * scale);
          canvas.height = Math.ceil(viewport.height * scale);
          canvas.style.width = `${Math.ceil(viewport.width)}px`;
          canvas.style.height = `${Math.ceil(viewport.height)}px`;
          await page.render({ canvasContext: context, viewport, transform: [scale, 0, 0, scale, 0, 0] }).promise;
          if (cancelled) return;
          root.append(canvas);
        }
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void render();
    return () => {
      cancelled = true;
      void destroy?.();
      root?.replaceChildren();
    };
  }, [blob]);

  const download = language === 'da' ? 'Download PDF' : language === 'en' ? 'Download PDF' : language === 'lt' ? 'Atsisiųsti PDF' : 'Pobierz PDF';
  const waiting = language === 'da' ? 'Indlæser PDF…' : language === 'en' ? 'Loading PDF…' : language === 'lt' ? 'Įkeliamas PDF…' : 'Wczytuję PDF…';
  const unavailable = language === 'da' ? 'Denne telefon kan ikke vise forhåndsvisningen. Du kan stadig åbne PDF-filen.' : language === 'en' ? 'This phone cannot show the preview. You can still open the PDF file.' : language === 'lt' ? 'Šiame telefone nepavyko parodyti peržiūros. Vis tiek galite atidaryti PDF failą.' : 'Ten telefon nie może wyświetlić podglądu. Nadal możesz otworzyć plik PDF.';
  return <div className="pdf-renderer">
    {!ready && !failed && <p className="pdf-preview-status">{waiting}</p>}
    {failed && <p className="pdf-preview-status">{unavailable}</p>}
    {fallbackUrl && <a className="secondary-button pdf-fallback-link" href={fallbackUrl} download="TIMEREGISTRERING.pdf">{download}</a>}
    <div className="pdf-canvas-pages" ref={container}/>
  </div>;
}
