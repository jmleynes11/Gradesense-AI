from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from lxml import etree as E
import json
import pypdfium2 as pdfium
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).parent
SOURCE = Path(r'C:\Users\jmley\AppData\Local\Temp\codex-file-preview-sAiyFM\SYSTEM TESTING.docx')
NS = {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def raster(pdf, directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    doc = pdfium.PdfDocument(str(pdf))
    for i in range(len(doc)):
        page = doc[i]
        im = page.render(scale=1.5).to_pil().convert('RGB')
        im.save(directory / f'page-{i+1}.png')
    for start in range(0,len(doc),6):
        sheet = Image.new('RGB',(1200,3*495),'#d0d0d0')
        draw = ImageDraw.Draw(sheet)
        for k in range(start,min(start+6,len(doc))):
            x,y=((k-start)%2)*600,((k-start)//2)*495
            im=Image.open(directory/f'page-{k+1}.png')
            sheet.paste(ImageOps.contain(im,(590,456)),(x+5,y+27))
            draw.text((x+10,y+7),f'Page {k+1}',fill='black')
        sheet.save(directory/f'contact-{start//6+1}.png')
    return len(doc)

if __name__ == '__main__':
    pages=raster(ROOT/'reference/reference.pdf', ROOT/'reference')
    with ZipFile(SOURCE) as z:
        inv={n:{'size':len(z.read(n)),'sha256':sha256(z.read(n)).hexdigest(),'policy':'editable' if n=='word/document.xml' else 'preserve-only'} for n in z.namelist()}
        r=E.fromstring(z.read('word/document.xml'))
        tables=r.findall('w:body/w:tbl',NS)
        paras=r.findall('w:body/w:p',NS)
        evidence={'parts':inv,'sections':[E.tostring(s,encoding='unicode') for s in r.findall('.//w:sectPr',NS)],'paragraphs':[{'i':i,'text':''.join(p.itertext())} for i,p in enumerate(paras)],'tables':[{'i':i,'rows':len(t.findall('w:tr',NS)),'grid':E.tostring(t.find('w:tblGrid',NS),encoding='unicode')} for i,t in enumerate(tables)]}
    (ROOT/'template-evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
    contract=f'''# GradeSense AI testing report template contract
Reference: {SOURCE}
SHA256: {sha256(SOURCE.read_bytes()).hexdigest()}
Reference render: {ROOT/'reference'}; {pages} pages; one section.

## Page system
Letter landscape 15840 by 12240 twips; margins top 1440, bottom 720, left/right 1080; header/footer 720. One default empty header, no page-number field. Preserve sectPr exactly.

## Typography and recurring components
Arial 11 pt default; line spacing 276/240. Existing title centered bold 21 pt. Heading styles Heading1 20 pt, Heading2 16 pt, Heading3 14 pt, with direct source overrides retained. Body uses original normal style; paragraph spacing from cloned source roles. Plain black text, black table borders, top cell alignment, 100-twip cell padding. No images, text boxes, footnotes, fields, controls, comments, or drawings. Preserve original numbering, bookmarks, style definitions, empty header and relationships.

## Flow and slots
All 24 original numbered sections and Appendix A through E remain in original order. Body paragraph indices 0..178 and table indices 0..23 are stable baseline locators in word/document.xml. Paragraphs 1..3 contain title/group/evaluators. Table 0 is document information. Tables 1..6 cover users, modules, method, hardware, software and datasets. Table 7 is full test case format; table 8 functional summary, 9 input, 10 database, 11 API, 12 performance, 13 security, 14 browsers, 15 devices, 16 UI, 17 ISO, 18 defects, 19 severity, 20 retest, 21 regression, 22 results, 23 approvals.

All blank fields and generic sample rows are rewrite slots; unknown identifying information remains bracketed placeholders. Existing instructional paragraphs remain unless their past-tense wording would imply actual execution; those are rewritten in place. Row cloning is allowed for realistic coverage; remove Other user role because unsupported. Clone existing body and Heading3 paragraph patterns for detailed Appendix A cases and evidence/defect documentation. Existing rows can grow vertically. Set repeated headers and prevent row splitting to keep expanded tables readable; keep headings with following content. Preserve table widths, column grids, styles, borders, spacing, font sizes and section geometry. Increased page count is expected from completed content. No generic redesign or font shrinking.

## Labeling and evidence
Opening notice states no tests executed. Every result uses Example or ILL-PASS/ILL-FAIL legend, all measurements labeled illustrative/unverified, every environment row labeled assumed. Defects and retests hypothetical, no names/signatures/dates fabricated. Summary counts only explicitly identified scenario IDs, with zero actual executions. Real logs and screenshots stay evidence placeholders.

## Package fidelity
See template-evidence.json for every part size and SHA256. Only word/document.xml is editable. All other ZIP members and relationships must remain byte-identical. Patch ZIP directly rather than round-trip through Word or python-docx. Render read-only through Word PDF export because packaged LibreOffice is unavailable on Windows; render_docx.py failure logged in task. Rasterize all PDF pages with bundled pypdfium2 and inspect PNGs. Retained reference remains unchanged.
'''
    (ROOT/'artifact.md').write_text(contract,encoding='utf-8')
    print(f'Reference: {pages} pages; {len(tables)} tables; {len(paras)} body paragraphs')
