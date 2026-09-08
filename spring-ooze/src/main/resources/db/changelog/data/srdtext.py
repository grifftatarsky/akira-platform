"""Reading the SRD PDF: the parts every chapter parser needs.

Three extractions of the same book, each used where it is clean:

* `pdftotext -layout` over a whole page, for tables that span the page and whose
  columns line up — the layout text *is* the table.
* the same with `-x`/`-W`, for a table that lives in one of the two page columns.
* `pdftohtml -xml`, for anything with prose. It carries the font of every run,
  and the book sets its headings in one distinctive face. That is what a heading
  *is*, so detecting them by font finds wrapped ones and never mistakes a
  sentence for one — which reading layout text cannot manage, because a heading
  and the first line of the paragraph under it look identical once the font is
  gone.
"""
import os
import re
import subprocess
import xml.etree.ElementTree as ET

PDF = os.environ.get('SRD_PDF', 'srd521.pdf')


# The book's own type palette, by (family, size, color).
HEAD = ('CFGFPT+GillSans-SemiBold', '18', '#88191f')
SECTION = ('CFGFPT+GillSans-SemiBold', '21', '#88191f')
CHAPTER = ('CFGFPT+GillSans-SemiBold', '27', '#88191f')
FURNITURE = '#7b7879'  # running head and folio
COL_SPLIT = 445  # pdftohtml renders the 594pt page 891 units wide

COIN_GP = {'CP': 0.01, 'SP': 0.1, 'EP': 0.5, 'GP': 1.0, 'PP': 10.0}


def norm(text):
    for a, b in (('−', '-'), ('–', '-'), ('—', '—'), ('’', "'"),
                 ('‘', "'"), ('“', '"'), ('”', '"'), (' ', ' ')):
        text = text.replace(a, b)
    return text


def layout(first, last=None, x=None, width=None):
    cmd = ['pdftotext', '-layout', '-f', str(first), '-l', str(last or first)]
    if x is not None:
        cmd += ['-x', str(x), '-y', '0', '-W', str(width), '-H', '783']
    cmd += [PDF, '-']
    return norm(subprocess.run(cmd, capture_output=True, text=True, check=True).stdout)


def _xml(first, last):
    return subprocess.run(
        ['pdftohtml', '-xml', '-f', str(first), '-l', str(last), '-i', '-stdout', PDF],
        capture_output=True, text=True, check=True).stdout


def _all_italic(el):
    """True when every character of a run is inside an <i>: the book sets a magic
    item's type line entirely in italic, and nothing else in a description is."""
    whole = ''.join(el.itertext()).strip()
    inside = ''.join(''.join(i.itertext()) for i in el.iter('i')).strip()
    return bool(whole) and whole == inside


def xml_cells(first, last, split_columns=True):
    """(page, column, top, cells) with each run kept separate and positioned.

    What {@code xml_lines} joins, this leaves apart. A table's cells are runs at
    known offsets, and a parser that has them cannot be fooled by a value with a
    space in it ("+30 ft.") or a header label that wraps onto two lines ("Rage"
    above "Damage") — both of which defeat splitting the rendered text.
    """
    root = ET.fromstring(_xml(first, last))
    specs = {}
    for page in root.findall('page'):
        for s in page.findall('fontspec'):
            specs[s.get('id')] = (s.get('family'), s.get('size'), s.get('color'))
        num = int(page.get('number'))
        runs = []
        for tx in page.findall('text'):
            spec = specs.get(tx.get('font'))
            if spec and spec[2] == FURNITURE:
                continue
            text = norm(''.join(tx.itertext()))
            if not text.strip():
                continue
            left, top = int(tx.get('left')), int(tx.get('top'))
            runs.append((0 if split_columns and left < COL_SPLIT else 1 if split_columns else 0,
                         top, left,
                         left + int(tx.get('width')), text.strip(), spec))
        rows, anchor = {}, None
        for col, top, *rest in sorted(runs):
            if anchor is None or anchor[0] != col or top - anchor[1] > 4:
                anchor = (col, top)
            rows.setdefault(anchor, []).append(tuple(rest))
        for (col, top), cells in sorted(rows.items()):
            yield num, col, top, sorted(cells)


def xml_lines(first, last):
    """(page, kind, indented, italic, text) per line, columns in reading order.

    Runs sharing a baseline are joined, so a table row arrives as one line
    instead of one line per cell.
    """
    root = ET.fromstring(_xml(first, last))
    specs = {}
    for page in root.findall('page'):
        for s in page.findall('fontspec'):
            specs[s.get('id')] = (s.get('family'), s.get('size'), s.get('color'))
        num = int(page.get('number'))
        runs = []
        for tx in page.findall('text'):
            spec = specs.get(tx.get('font'))
            if spec and spec[2] == FURNITURE:
                continue
            text = norm(''.join(tx.itertext()))
            if not text.strip():
                continue
            left, top = int(tx.get('left')), int(tx.get('top'))
            runs.append((0 if left < COL_SPLIT else 1, top, left,
                         left + int(tx.get('width')), text, spec, _all_italic(tx)))
        # Group by baseline rather than by a fixed band: a wrapped table cell can
        # sit a unit off its row's top, and rounding splits the row in two.
        rows, anchor = {}, None
        for col, top, *rest in sorted(runs):
            if anchor is None or anchor[0] != col or top - anchor[1] > 4:
                anchor = (col, top)
            rows.setdefault(anchor, []).append(tuple(rest))
        merged = []
        for (col, _top), cells in sorted(rows.items()):
            cells.sort()
            spec = cells[0][3]
            table = (spec and 'GillSans' in spec[0]
                     and spec not in (HEAD, SECTION, CHAPTER))
            # A table cell that wrapped prints as a lone run under the first
            # column of the row above — "Potion of Healing" / "(greater)".
            if (table and len(cells) == 1 and merged and len(merged[-1][1]) > 1
                    and merged[-1][0][0] == col
                    and abs(merged[-1][1][0][0] - cells[0][0]) < 5):
                prev = merged[-1][1]
                l, r, text, sp, it = prev[0]
                prev[0] = (l, r, text.rstrip() + ' ' + cells[0][2].strip(), sp, it)
                continue
            merged.append(((col, _top), cells))
        for (_col, _top), cells in merged:
            spec = cells[0][3]
            italic = all(c[4] for c in cells)
            # The book sets tables in GillSans and running prose in Cambria, so
            # the face says which one a line is — and a table must not be
            # reflowed into a paragraph.
            kind = {HEAD: 'head', SECTION: 'section', CHAPTER: 'chapter'}.get(
                spec, 'table' if spec and 'GillSans' in spec[0] else 'body')
            # The book marks a new paragraph by indenting it, and that indent is
            # the only signal of where one ends — the lines are hard-wrapped.
            indented = cells[0][2].startswith('  ')
            # Rebuild the line from the gaps between runs, keeping each run's own
            # spaces. A fragment split off by a font change sits flush against its
            # neighbour — a hyphen at a line break, an italic spell name — while a
            # table cell is a wide gap away and needs a separator invented for it.
            line, right = '', None
            for left, end, text, _spec, _ital in cells:
                gap = 0 if right is None else left - right
                if gap >= 14:
                    line += '  '
                elif gap >= 3 and not (line.endswith(' ') or text.startswith(' ')):
                    line += ' '
                line += text
                right = end
            yield num, kind, indented, italic, re.sub(r'[ \t]{3,}', '  ', line).strip()


def money(text):
    """'1,500 GP' -> 1500.0, '5 CP' -> 0.05, '-' or 'Varies' -> None."""
    m = re.match(r'^([\d,]+(?:\.\d+)?)\s*(CP|SP|EP|GP|PP)$', text.strip())
    return round(float(m.group(1).replace(',', '')) * COIN_GP[m.group(2)], 2) if m else None


def pounds(text):
    """'1/4 lb.' -> 0.25, '58 1/2 lb.' -> 58.5, '-' or 'Varies' -> None."""
    t = text.replace('½', ' 1/2').replace(' lb.', '').replace('(full)', '').strip()
    m = re.match(r'^(\d+)?\s*(?:(\d+)/(\d+))?$', t)
    if not m or not any(m.groups()):
        return None
    whole = int(m.group(1) or 0)
    frac = int(m.group(2)) / int(m.group(3)) if m.group(2) else 0
    return round(whole + frac, 2)


def join_wrapped(head, tail):
    """Append a wrapped line. A trailing hyphen before a lowercase continuation is
    the typesetter's, not the word's, so it closes up rather than spacing out."""
    if not head:
        return tail
    if head.endswith('-') and tail[:1].islower():
        # A hyphen after a digit is the book's own ("a 40-foot radius") and stays;
        # every other line-break hyphen in these two chapters splits a word.
        # Measured: 7 digit-led against 332 word-led, and of those 332 only a
        # handful ("non-magical", "trap-door") are real compounds, which still
        # read correctly closed up.
        return head + tail if head[-2:-1].isdigit() else head[:-1] + tail
    return head + ' ' + tail


def reflow(lines):
    """Hard-wrapped book lines back into paragraphs, on the indent that starts one.

    A table row keeps its own line: it was never a sentence, and running one into
    the surrounding prose turns a legible three-column table into a word salad.
    """
    paras, cur, table = [], '', []

    def flush():
        nonlocal cur, table
        if cur:
            paras.append(cur.strip())
            cur = ''
        if table:
            paras.append('\n'.join(table))
            table = []

    for kind, indented, text in lines:
        if kind == 'table':
            if cur:
                flush()
            table.append(text)
            continue
        if table or (indented and cur):
            flush()
        cur = join_wrapped(cur, text)
    flush()
    return '\n\n'.join(p for p in paras if p.strip())

