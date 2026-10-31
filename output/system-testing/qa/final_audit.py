from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
from lxml import etree as E
import re,json
import pypdfium2 as pdfium
from pypdf import PdfReader
from inspect_template import raster,SOURCE

base=Path(__file__).parent
docx=base.parent/'GradeSense-AI Completed System Testing Report.docx'
pdf=base/'completed-final.pdf'
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
with ZipFile(SOURCE) as src,ZipFile(docx) as out:
    assert src.namelist()==out.namelist()
    assert all(src.read(n)==out.read(n) for n in src.namelist() if n!='word/document.xml')
    root=E.fromstring(out.read('word/document.xml'))
    original=E.fromstring(src.read('word/document.xml'))
    assert E.tostring(root.find('.//w:sectPr',ns))==E.tostring(original.find('.//w:sectPr',ns))
    tables=root.findall('w:body/w:tbl',ns)
    for a,b in zip(original.findall('w:body/w:tbl',ns),tables):
        assert E.tostring(a.find('w:tblGrid',ns))==E.tostring(b.find('w:tblGrid',ns))
    assert len(tables)==24
    ids=root.xpath('//w:bookmarkStart/@w:id',namespaces=ns)
    assert len(ids)==len(set(ids))
    assert not E.fromstring(out.read('word/settings.xml')).findall('.//w:documentProtection',ns)

allcases=[]
for i,statuscol in [(8,5),(9,5),(10,5),(11,5),(12,5),(13,5),(14,2),(15,3),(16,4),(21,3)]:
    for row in tables[i].findall('w:tr',ns)[1:]:
        cells=row.findall('w:tc',ns)
        label=''.join(cells[0].xpath('.//w:t/text()',namespaces=ns))
        status=''.join(cells[statuscol].xpath('.//w:t/text()',namespaces=ns))
        assert 'ILL-PASS' in status or 'ILL-FAIL' in status
        allcases.append((label,'ILL-PASS' if 'ILL-PASS' in status else 'ILL-FAIL'))
assert len(allcases)==72
assert sum(s=='ILL-PASS' for _,s in allcases)==68
assert sum(s=='ILL-FAIL' for _,s in allcases)==4
text=' '.join(root.xpath('//w:t/text()',namespaces=ns))
assert '____' not in text
for i in range(1,25):
    assert any(re.match(rf'^{i}\. ',''.join(p.xpath('.//w:t/text()',namespaces=ns))) for p in root.findall('w:body/w:p',ns))

pages=PdfReader(pdf).pages
pdftxt='\n'.join(p.extract_text() for p in pages)
norm=lambda t:re.sub(r'\W','',t.casefold())
fullnorm=norm(pdftxt)
missing=[]
for p in root.findall('.//w:p',ns):
    s=''.join(p.xpath('.//w:t/text()',namespaces=ns))
    if len(s)>10 and norm(s) not in fullnorm:missing.append(s)
assert not missing,missing

pdfdoc=pdfium.PdfDocument(str(pdf))
bounds=[]
for i in range(len(pdfdoc)):
    pg=pdfdoc[i];tp=pg.get_textpage();boxes=[]
    for k in range(tp.count_chars()):
        if tp.get_text_range(k,1).strip():boxes.append(tp.get_charbox(k))
    x0=min(b[0] for b in boxes);y0=min(b[1] for b in boxes)
    x1=max(b[2] for b in boxes);y1=max(b[3] for b in boxes)
    assert x0>=45 and y0>=25 and x1<=pg.get_width()-30 and y1<=pg.get_height()-45,(i+1,x0,y0,x1,y1)
    bounds.append([i+1,round(x0,1),round(y0,1),round(x1,1),round(y1,1)])

count=raster(pdf,base/'delivery-render')
audit={'docx':str(docx),'sha256':sha256(docx.read_bytes()).hexdigest(),'pages':count,'sections':24,'original_table_count':24,'unchanged_package_parts':9,'page_geometry_and_table_grids':'preserved','editable':True,'illustrative_cases':len(allcases),'illustrative_passes':68,'illustrative_failures':4,'actual_executions':0,'rendered_paragraph_coverage':'all populated paragraphs found in rendered PDF','text_bounds':'all pages within printable area','bounds':bounds}
(base/'final-audit.json').write_text(json.dumps(audit,indent=2),encoding='utf-8')
with (base/'artifact.md').open('a',encoding='utf-8') as f:
    f.write('\n## Final fidelity record\nOriginal VML horizontal rules include both section dividers and fill-in lines. Fill-in lines in populated paragraph slots 32, 55, 56, 141, 143 and 149..153 were removed as completed-field replacements; section rules retained. Abbreviated labels fit narrow original columns; all original grids, font styles, sizes and page geometry retained. Rendered in Microsoft Word read-only via PDF export, never resaved. Final render: delivery-render; 45 pages. Nine preserve-only package parts byte-identical. See final-audit.json for counts, text coverage and page bounds.\n')
print(json.dumps({k:v for k,v in audit.items() if k!='bounds'},indent=2))
