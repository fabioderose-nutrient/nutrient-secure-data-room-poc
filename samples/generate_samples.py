"""Generates the fictitious data room documents of the demo.

Project Heron: the sale of Merrow Flow Controls Ltd, an invented maker of
industrial valves. Every company, person, address, figure and reference in
these files is invented.

Output in samples/documents/:

  information-memorandum.pdf        PDF (reportlab)
  financial-summary-fy2023-2025.pdf PDF (reportlab)
  lease-unit-7-brookmere.pdf        PDF (reportlab)
  employment-policies.docx          Word (python-docx), converted by Document Engine
  customer-contracts-register.xlsx  Excel (openpyxl), converted by Document Engine
  ip-register.xlsx                  Excel (openpyxl), converted by Document Engine

Run:  python samples/generate_samples.py
"""

from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Mm, Pt, RGBColor
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = Path(__file__).resolve().parent / "documents"
TARGET = "Merrow Flow Controls Ltd"
PROJECT = "Project Heron"
ADVISOR = "Larkspur Advisory LLP"
INK = colors.HexColor("#1f2933")
MUTED = colors.HexColor("#5f6b7a")
LINE = colors.HexColor("#c9d1db")
HEAD = colors.HexColor("#e8edf2")

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK, spaceAfter=8)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=INK, spaceBefore=10, spaceAfter=5)
BODY = ParagraphStyle("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.6, leading=13.4, textColor=INK, spaceAfter=6)
SMALL = ParagraphStyle("Small", parent=BODY, fontSize=8, leading=10.5, textColor=MUTED)
BULLET = ParagraphStyle("Bullet", parent=BODY, leftIndent=12, bulletIndent=2, spaceAfter=3)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=8.6, leading=11, spaceAfter=0)
CELL_B = ParagraphStyle("CellB", parent=CELL, fontName="Helvetica-Bold")


def footer(title):
    def draw(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(18 * mm, 16 * mm, A4[0] - 18 * mm, 16 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 11.5 * mm, f"{PROJECT} - {title} - Strictly private and confidential")
        canvas.drawRightString(A4[0] - 18 * mm, 11.5 * mm, f"Page {doc.page}")
        canvas.restoreState()

    return draw


def build_pdf(name, title, story):
    doc = SimpleDocTemplate(
        str(OUT / name),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=22 * mm,
        title=f"{PROJECT} - {title}",
        author=ADVISOR,
        subject=f"Data room document - {TARGET}",
    )
    doc.build(story, onFirstPage=footer(title), onLaterPages=footer(title))


def table(rows, widths, header=True, align_right_from=None, bold_rows=()):
    data = [[Paragraph(str(c), CELL_B if (header and r == 0) or r in bold_rows else CELL) for c in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), HEAD))
    t.setStyle(TableStyle(style))
    if align_right_from is not None:
        for r, row in enumerate(data):
            for c in range(align_right_from, len(row)):
                row[c].style = ParagraphStyle(f"R{r}{c}", parent=row[c].style, alignment=2)
    return t


def bullets(items):
    return [Paragraph(i, BULLET, bulletText="-") for i in items]


# ---------------------------------------------------------------------------
# 1. Information memorandum (summary)
# ---------------------------------------------------------------------------


def information_memorandum():
    title = "Information memorandum (summary)"
    s = [
        Spacer(1, 30 * mm),
        Paragraph(PROJECT, ParagraphStyle("Code", parent=H1, fontSize=28, leading=34, alignment=TA_CENTER)),
        Paragraph("Confidential information memorandum - summary", ParagraphStyle("Sub", parent=H2, alignment=TA_CENTER, fontSize=14)),
        Spacer(1, 8 * mm),
        Paragraph(f"Proposed sale of 100% of the share capital of {TARGET}", ParagraphStyle("C", parent=BODY, alignment=TA_CENTER, fontSize=11)),
        Spacer(1, 4 * mm),
        Paragraph(f"Prepared by {ADVISOR} for the shareholders of {TARGET}<br/>October 2026", ParagraphStyle("C2", parent=BODY, alignment=TA_CENTER, textColor=MUTED)),
        Spacer(1, 40 * mm),
        Paragraph("Important notice", H2),
        Paragraph(
            "This memorandum is provided to a limited number of parties that have signed a non-disclosure agreement. "
            "It may not be copied, printed, forwarded or disclosed in whole or in part. Access to the virtual data room "
            "is personal. Every document opened, every page viewed and every download is recorded, and every page "
            "shows the name of the person viewing it.",
            BODY,
        ),
        Paragraph(
            "No representation or warranty is given as to the accuracy or completeness of the information. Interested "
            "parties must rely on their own due diligence. All figures are unaudited management information unless stated.",
            BODY,
        ),
        PageBreak(),
        Paragraph("1. The business at a glance", H1),
        Paragraph(
            f"{TARGET} designs, manufactures and services control valves and electric actuators for water utilities, "
            "food and beverage plants and chemical processing. The company was founded in 1998 and operates from a single "
            "leased site at Unit 7, Brookmere Trading Estate, with 214 employees.",
            BODY,
        ),
        table(
            [
                ["Key facts", "FY2025"],
                ["Revenue", "GBP 45.9m"],
                ["Adjusted EBITDA", "GBP 8.4m (18.3% margin)"],
                ["Recurring aftermarket revenue", "34% of revenue"],
                ["Customers under framework agreements", "41"],
                ["Employees (FTE)", "214"],
                ["Installed base", "c. 62,000 valves in service"],
            ],
            [70 * mm, 104 * mm],
        ),
        Paragraph("2. Investment highlights", H2),
        *bullets(
            [
                "Specified on 7 of the 10 largest regional water framework agreements; average customer tenure of 11 years.",
                "Aftermarket and service revenue grew at 14% a year since FY2023, with a gross margin above 45%.",
                "Own actuator platform (MF-Series) protected by registered designs and two granted patents.",
                "Stable management team; the founders intend to retire after a 12-month handover.",
                "Clear growth plan: retrofit programme for older installed valves and a second assembly line in FY2027.",
            ]
        ),
        Paragraph("3. Products and services", H2),
        table(
            [
                ["Segment", "Main products", "FY2025 revenue", "Share"],
                ["Control valves", "Globe, butterfly and plug valves, DN25 to DN600", "GBP 21.7m", "47%"],
                ["Actuation", "MF-Series electric actuators, positioners", "GBP 8.6m", "19%"],
                ["Aftermarket", "Spare parts, service contracts, retrofits", "GBP 15.6m", "34%"],
            ],
            [32 * mm, 80 * mm, 34 * mm, 28 * mm],
            align_right_from=2,
        ),
        PageBreak(),
        Paragraph("4. Process and timetable", H1),
        table(
            [
                ["Phase", "Dates", "What happens"],
                ["Phase 1", "Until 14 November 2026", "Indicative non-binding offers on the basis of this memorandum"],
                ["Phase 2", "18 November to 19 December 2026", "Confirmatory due diligence in the virtual data room, management meetings, site visit"],
                ["Final offers", "9 January 2027", "Binding offers with a mark-up of the draft share purchase agreement"],
                ["Signing", "Target end of January 2027", "Exclusivity with the preferred bidder"],
            ],
            [26 * mm, 52 * mm, 96 * mm],
        ),
        Paragraph("5. Data room rules", H2),
        *bullets(
            [
                "Access is personal and limited to the folders opened to your bidder team.",
                "Documents are view only. Printing, copying text and saving are disabled.",
                "Every page shows your name, your company and the date and time of viewing.",
                "Downloads are limited to named deal leads. Each downloaded copy carries a permanent watermark and a reference number.",
                "The data room administrator can see which documents and pages each user opened, and for how long.",
                "Commercially sensitive information is released to clean team members only, subject to competition law advice.",
            ]
        ),
        Paragraph("6. Questions and contacts", H2),
        Paragraph(
            "Questions are submitted through the data room administrator only. Do not contact the management, employees, "
            "customers or suppliers of the company. Contacts at the advisor: Ruth Calloway (data room administrator), "
            "ruth.calloway@larkspur-advisory.example; Tomas Ilesanmi (director), tomas.ilesanmi@larkspur-advisory.example.",
            BODY,
        ),
    ]
    build_pdf("information-memorandum.pdf", title, s)


# ---------------------------------------------------------------------------
# 2. Financial summary
# ---------------------------------------------------------------------------


def financial_summary():
    title = "Financial summary FY2023-FY2025"
    w = [70 * mm, 26 * mm, 26 * mm, 26 * mm, 26 * mm]
    s = [
        Paragraph("Financial summary FY2023 to FY2025", H1),
        Paragraph(
            f"{TARGET}. Financial years end on 31 March. Figures in GBP thousands. FY2023 and FY2024 are audited; FY2025 is "
            "audited, signed on 18 July 2025. Adjustments are management estimates reviewed by the advisor.",
            SMALL,
        ),
        Paragraph("Income statement", H2),
        table(
            [
                ["GBP k", "FY2023", "FY2024", "FY2025", "CAGR"],
                ["Revenue", "38,240", "41,610", "45,930", "9.6%"],
                ["Cost of sales", "(25,120)", "(27,050)", "(29,410)", ""],
                ["Gross profit", "13,120", "14,560", "16,520", "12.2%"],
                ["Gross margin", "34.3%", "35.0%", "36.0%", ""],
                ["Overheads", "(7,410)", "(7,980)", "(8,620)", ""],
                ["Reported EBITDA", "5,710", "6,580", "7,900", "17.6%"],
                ["Owner salaries above market", "320", "330", "340", ""],
                ["One-off ERP implementation", "-", "410", "160", ""],
                ["Adjusted EBITDA", "6,030", "7,320", "8,400", "18.0%"],
                ["Adjusted EBITDA margin", "15.8%", "17.6%", "18.3%", ""],
                ["Depreciation and amortisation", "(1,240)", "(1,310)", "(1,420)", ""],
                ["Operating profit", "4,470", "5,270", "6,480", ""],
            ],
            w,
            align_right_from=1,
            bold_rows=(3, 9),
        ),
        Paragraph("Revenue by segment", H2),
        table(
            [
                ["GBP k", "FY2023", "FY2024", "FY2025", "CAGR"],
                ["Control valves", "19,880", "20,640", "21,730", "4.5%"],
                ["Actuation", "6,410", "7,350", "8,610", "15.9%"],
                ["Aftermarket", "11,950", "13,620", "15,590", "14.2%"],
                ["Total", "38,240", "41,610", "45,930", "9.6%"],
            ],
            w,
            align_right_from=1,
            bold_rows=(4,),
        ),
        PageBreak(),
        Paragraph("Balance sheet and cash", H1),
        table(
            [
                ["GBP k at 31 March", "FY2023", "FY2024", "FY2025", ""],
                ["Trade receivables", "7,820", "8,410", "9,050", ""],
                ["Inventory", "6,140", "6,980", "7,320", ""],
                ["Trade payables", "(4,910)", "(5,230)", "(5,610)", ""],
                ["Trade working capital", "9,050", "10,160", "10,760", ""],
                ["Working capital as % of revenue", "23.7%", "24.4%", "23.4%", ""],
                ["Capital expenditure", "(1,180)", "(2,640)", "(1,560)", ""],
                ["Cash", "2,310", "1,870", "3,940", ""],
                ["Bank loan", "(6,000)", "(5,000)", "(4,000)", ""],
                ["Net debt", "(3,690)", "(3,130)", "(60)", ""],
            ],
            w,
            align_right_from=1,
            bold_rows=(4, 9),
        ),
        Paragraph("Notes", H2),
        *bullets(
            [
                "FY2024 capital expenditure includes GBP 1.3m for the second CNC machining cell, commissioned in February 2024.",
                "The bank loan is repayable at GBP 1.0m a year and has a change of control clause: it is expected to be repaid at completion.",
                "Owner salaries above market: the two founders are paid GBP 170k each above the market rate for their roles.",
                "ERP implementation costs were expensed as incurred and are not expected to recur.",
                "Order book at 30 September 2026: GBP 19.2m, of which GBP 12.7m deliverable within 12 months.",
            ]
        ),
        Paragraph("Current trading", H2),
        Paragraph(
            "Revenue for the six months to 30 September 2026 was GBP 24.1m (prior year GBP 22.0m), with adjusted EBITDA of "
            "GBP 4.5m. Management expects FY2026 revenue of GBP 49.0m and adjusted EBITDA of GBP 9.2m.",
            BODY,
        ),
    ]
    build_pdf("financial-summary-fy2023-2025.pdf", title, s)


# ---------------------------------------------------------------------------
# 3. Lease
# ---------------------------------------------------------------------------


def lease():
    title = "Lease of Unit 7, Brookmere Trading Estate"
    clause = lambda n, head, text: KeepTogether([Paragraph(f"{n}. {head}", H2), Paragraph(text, BODY)])
    s = [
        Paragraph("Lease of Unit 7, Brookmere Trading Estate", H1),
        Paragraph("Summary of the lease prepared from the signed counterpart dated 1 March 2018. Clause numbers follow the lease.", SMALL),
        Paragraph("Particulars", H2),
        table(
            [
                ["Item", "Detail"],
                ["Landlord", "Brookmere Estates Ltd"],
                ["Tenant", TARGET],
                ["Premises", "Unit 7, Brookmere Trading Estate: production hall, offices and yard, 9,850 square metres in total"],
                ["Term", "15 years from 1 March 2018, ending 28 February 2033"],
                ["Initial rent", "GBP 412,500 a year, payable quarterly in advance"],
                ["Current rent", "GBP 447,800 a year since the review of 1 March 2023"],
                ["Rent review", "Every five years, upward only, to open market rent"],
                ["Tenant break", "1 March 2028, on at least six months' written notice"],
                ["Use", "Light industrial and ancillary offices"],
                ["Security of tenure", "Not excluded"],
            ],
            [38 * mm, 136 * mm],
        ),
        clause(
            "3",
            "Rent and rent review",
            "The rent is reviewed on 1 March 2023 and 1 March 2028 to the open market rent of the premises, assuming a "
            "willing landlord and tenant and a term equal to the unexpired residue. The reviewed rent can never be lower "
            "than the rent payable immediately before the review date. If the parties do not agree within three months, "
            "either party may refer the review to an independent surveyor acting as an expert.",
        ),
        clause(
            "4",
            "Repair and decoration",
            "The tenant must keep the premises in good and substantial repair and condition, including the roof, structure "
            "and the yard surface, and must redecorate the interior in the last year of the term. A schedule of condition "
            "was not attached to the lease, so the tenant's repairing obligation is not limited to the condition at the start "
            "of the term.",
        ),
        clause(
            "5",
            "Service charge and insurance",
            "The landlord insures the building and recovers the premium. The tenant pays a fair proportion of the estate "
            "service charge, currently 8.2% of the estate costs, capped at GBP 38,000 a year until the 2028 review.",
        ),
        PageBreak(),
        clause(
            "6",
            "Alienation",
            "The tenant may not assign or underlet the whole of the premises without the landlord's consent, which may not "
            "be unreasonably withheld. Assignment of part and underletting of part are prohibited. Sharing occupation with a "
            "group company is permitted on notice to the landlord.",
        ),
        clause(
            "7",
            "Change of control",
            "A change in the control of the tenant is not an assignment and does not require the landlord's consent. The "
            "tenant must notify the landlord within 20 working days after a change of control and provide the name of the "
            "new controlling shareholder. There is no rent deposit or guarantee requirement triggered by a change of control.",
        ),
        clause(
            "8",
            "Break clause",
            "The tenant may end the lease on 1 March 2028 by giving at least six months' written notice. The break is "
            "conditional on payment of the rent up to the break date and vacant possession. Compliance with the repairing "
            "covenants is not a condition of the break.",
        ),
        clause(
            "9",
            "Alterations",
            "Internal non-structural alterations are permitted. Structural alterations need the landlord's consent. The "
            "second CNC machining cell installed in 2024 was approved by a licence for alterations dated 12 December 2023. "
            "The landlord may require reinstatement at the end of the term.",
        ),
        clause(
            "10",
            "Environmental",
            "The tenant is liable for contamination caused during the term. A phase 1 environmental report prepared at the "
            "start of the lease found no significant contamination. The tenant holds an environmental permit for the paint "
            "shop, which is transferable with the business.",
        ),
        PageBreak(),
        Paragraph("Points for buyers", H1),
        *bullets(
            [
                "The change of control does not need landlord consent (clause 7). A notice is enough.",
                "The upward only review on 1 March 2028 coincides with the tenant break date. Agents estimate the open market rent at GBP 455,000 to 470,000 a year.",
                "The full repairing obligation without a schedule of condition creates a dilapidations exposure at the end of the term. "
                "A surveyor's estimate from May 2026 puts it at GBP 310,000.",
                "The reinstatement obligation for the CNC cell could add GBP 85,000 if the landlord requires it.",
                "Security of tenure is not excluded: the tenant has a statutory right to a new lease in 2033.",
            ]
        ),
        Paragraph("Rent schedule", H2),
        table(
            [
                ["Period", "Annual rent", "Basis"],
                ["1 March 2018 to 28 February 2023", "GBP 412,500", "Initial rent"],
                ["1 March 2023 to 28 February 2028", "GBP 447,800", "Agreed review, memorandum dated 20 April 2023"],
                ["From 1 March 2028", "To be reviewed", "Open market, upward only"],
            ],
            [64 * mm, 34 * mm, 76 * mm],
        ),
        Spacer(1, 6 * mm),
        Paragraph("Signed counterparts, the licence for alterations and the 2023 rent review memorandum are available on request through the data room administrator.", SMALL),
    ]
    build_pdf("lease-unit-7-brookmere.pdf", title, s)


# ---------------------------------------------------------------------------
# 4. Employment policies (Word)
# ---------------------------------------------------------------------------


def employment_policies():
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Arial"
    style.font.size = Pt(10)
    for name in ("Heading 1", "Heading 2"):
        doc.styles[name].font.name = "Arial"
        doc.styles[name].font.color.rgb = RGBColor(0x1F, 0x29, 0x33)

    doc.core_properties.author = TARGET
    doc.core_properties.title = f"{PROJECT} - Employment policies summary"
    section = doc.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)
    section.left_margin = section.right_margin = Mm(20)
    footer_p = section.footer.paragraphs[0]
    footer_p.text = f"{PROJECT} - Employment policies summary - Strictly private and confidential"
    footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer_p.runs[0].font.size = Pt(8)

    doc.add_heading("Employment policies summary", level=1)
    p = doc.add_paragraph(f"{TARGET}. Prepared by the HR manager for the data room, October 2026. Individual contracts are not disclosed at this stage.")
    p.runs[0].italic = True

    doc.add_heading("1. Headcount", level=2)
    rows = [
        ("Function", "FTE", "Average tenure (years)", "Union members"),
        ("Production and assembly", "121", "9.4", "68"),
        ("Engineering and design", "31", "7.8", "0"),
        ("Field service", "27", "6.1", "11"),
        ("Sales and customer support", "19", "5.5", "0"),
        ("Finance, HR and IT", "16", "8.2", "0"),
        ("Total", "214", "8.3", "79"),
    ]
    t = doc.add_table(rows=len(rows), cols=4)
    t.style = "Light Grid Accent 1"
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            t.cell(r, c).text = value

    doc.add_heading("2. Terms and conditions", level=2)
    for text in [
        "Standard working week of 37.5 hours. Production works two shifts, Monday to Friday.",
        "Notice periods: one month for staff, three months for managers, six months for the two founders and the finance director.",
        "Annual leave: 25 days plus public holidays, rising to 28 days after ten years of service.",
        "Pension: defined contribution scheme, employer contribution 6% of basic salary. There is no defined benefit scheme.",
        "Sick pay: full pay for 10 days a year, then statutory sick pay.",
    ]:
        doc.add_paragraph(text, style="List Bullet")

    doc.add_heading("3. Bonus and incentives", level=2)
    doc.add_paragraph(
        "All employees take part in a profit share scheme that pays up to 5% of basic salary if adjusted EBITDA exceeds budget. "
        "The FY2025 payment was 3.5% of basic salary, GBP 312,000 in total. Managers have an individual bonus of up to 20% of salary."
    )
    doc.add_paragraph(
        "Change of control: six senior managers hold retention letters that pay 50% of annual salary if they are still employed "
        "12 months after a change of control. The total cost is estimated at GBP 386,000. The founders have no retention arrangement."
    )

    doc.add_heading("4. Collective arrangements", level=2)
    doc.add_paragraph(
        "A recognition agreement with a trade union covers production and field service employees. Pay is negotiated each April. "
        "The 2026 settlement was 4.2%. There have been no strikes or formal disputes in the last ten years."
    )

    doc.add_heading("5. Policies in the employee handbook", level=2)
    rows = [
        ("Policy", "Last reviewed", "Notes"),
        ("Health and safety", "January 2026", "ISO 45001 certified site"),
        ("Equal opportunities and dignity at work", "March 2025", ""),
        ("Disciplinary and grievance", "March 2025", "Follows the statutory code of practice"),
        ("Whistleblowing", "June 2024", "External hotline since 2024"),
        ("Data protection", "September 2025", "Data protection officer: finance director"),
        ("Hybrid working", "February 2024", "Office staff, up to two days a week at home"),
        ("Anti-bribery", "May 2025", "Annual training, 100% completion in FY2025"),
    ]
    t = doc.add_table(rows=len(rows), cols=3)
    t.style = "Light Grid Accent 1"
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            t.cell(r, c).text = value

    doc.add_heading("6. Claims and investigations", level=2)
    doc.add_paragraph(
        "One employment tribunal claim (unfair dismissal) is open, filed in May 2026, with a maximum exposure of GBP 45,000. "
        "The company's insurer has accepted the claim. The site had one reportable accident in FY2025 and none in FY2026 to date."
    )
    doc.save(OUT / "employment-policies.docx")


# ---------------------------------------------------------------------------
# 5. Excel registers
# ---------------------------------------------------------------------------

THIN = Side(style="thin", color="C9D1DB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEAD_FILL = PatternFill("solid", fgColor="E8EDF2")


def write_sheet(ws, title, note, header, rows, widths, money_cols=()):
    ws["A1"] = title
    ws["A1"].font = Font(name="Arial", bold=True, size=13)
    ws["A2"] = note
    ws["A2"].font = Font(name="Arial", italic=True, size=9, color="5F6B7A")
    start = 4
    for c, value in enumerate(header, start=1):
        cell = ws.cell(row=start, column=c, value=value)
        cell.font = Font(name="Arial", bold=True, size=9)
        cell.fill = HEAD_FILL
        cell.border = BORDER
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    for r, row in enumerate(rows, start=start + 1):
        for c, value in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=value)
            cell.font = Font(name="Arial", size=9)
            cell.border = BORDER
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            if c in money_cols:
                cell.number_format = "#,##0"
            if isinstance(value, date):
                cell.number_format = "dd mmm yyyy"
    for c, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(c)].width = width
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{start}:{start}"
    ws.oddFooter.center.text = f"{PROJECT} - Strictly private and confidential"
    return start + len(rows)


def customer_contracts():
    wb = Workbook()
    ws = wb.active
    ws.title = "Contracts"
    header = ["Ref", "Customer", "Sector", "Contract type", "Start", "End", "FY2025 revenue (GBP)", "Pricing", "Change of control", "Notes"]
    rows = [
        ("C-001", "Tamsworth Water Services", "Water", "Framework", date(2021, 4, 1), date(2027, 3, 31), 6120000, "Indexed to CPI, annual", "Consent required", "Largest customer, 13% of revenue"),
        ("C-002", "Pellow Process Engineering", "Chemicals", "Supply agreement", date(2022, 1, 1), date(2026, 12, 31), 3480000, "Fixed price list", "None", "Renewal under negotiation"),
        ("C-003", "Eastvale Utilities Group", "Water", "Framework", date(2020, 7, 1), date(2028, 6, 30), 3260000, "Indexed to CPI, annual", "Termination right", "Exclusive supplier for actuators"),
        ("C-004", "Hollins Dairy Cooperative", "Food and beverage", "Service contract", date(2023, 3, 1), date(2028, 2, 28), 1940000, "Fixed fee plus parts", "None", ""),
        ("C-005", "Corvale Chemical Works", "Chemicals", "Purchase orders", None, None, 1720000, "Quoted per order", "None", "No written contract"),
        ("C-006", "Southmere Water", "Water", "Framework", date(2019, 10, 1), date(2027, 9, 30), 1690000, "Indexed to CPI, annual", "Consent required", ""),
        ("C-007", "Brayford Brewing Company", "Food and beverage", "Supply agreement", date(2024, 5, 1), date(2029, 4, 30), 1310000, "Fixed for 2 years, then CPI", "None", "Volume rebate 3% above GBP 1.2m"),
        ("C-008", "Nethercott Pharma Services", "Pharma", "Supply agreement", date(2022, 9, 1), date(2027, 8, 31), 1180000, "Fixed price list", "Termination right", "Validation documents held by customer"),
        ("C-009", "Riverside Sugar Refiners", "Food and beverage", "Service contract", date(2021, 2, 1), date(2026, 1, 31), 960000, "Fixed fee plus parts", "None", "Expired, rolling monthly"),
        ("C-010", "Greywell Energy Recovery", "Energy", "Project", date(2025, 6, 1), date(2027, 5, 31), 880000, "Fixed project price", "None", "Milestone billing"),
        ("C-011", "Ashcombe Water", "Water", "Framework", date(2023, 4, 1), date(2029, 3, 31), 840000, "Indexed to CPI, annual", "Consent required", "New in FY2024"),
        ("C-012", "Fallowfield Foods", "Food and beverage", "Purchase orders", None, None, 610000, "Quoted per order", "None", ""),
        ("C-013", "Kingsmoor Paper Mills", "Paper", "Service contract", date(2024, 1, 1), date(2026, 12, 31), 540000, "Fixed fee plus parts", "None", ""),
        ("C-014", "Lowther Chemicals", "Chemicals", "Supply agreement", date(2020, 11, 1), date(2026, 10, 31), 470000, "Fixed price list", "None", "Not renewed, last orders in Q4"),
        ("C-015", "Other customers (212)", "Various", "Mostly purchase orders", None, None, 20910000, "Price list", "None", "No customer above GBP 0.4m"),
    ]
    last = write_sheet(
        ws,
        f"Customer contracts register - {TARGET}",
        "Clean team only. Top customers by FY2025 revenue. Contract copies are available to clean team members on request.",
        header,
        rows,
        [7, 26, 15, 16, 11, 11, 14, 22, 16, 30],
        money_cols=(7,),
    )
    ws.cell(row=last + 1, column=2, value="Total").font = Font(name="Arial", bold=True, size=9)
    # A plain value, not a formula: openpyxl does not compute formulas.
    total = ws.cell(row=last + 1, column=7, value=sum(r[6] for r in rows))
    total.number_format = "#,##0"
    total.font = Font(name="Arial", bold=True, size=9)
    wb.properties.creator = TARGET
    wb.save(OUT / "customer-contracts-register.xlsx")


def ip_register():
    wb = Workbook()
    ws = wb.active
    ws.title = "IP register"
    header = ["Ref", "Type", "Title or mark", "Territory", "Status", "Filed", "Owner", "Renewal or expiry", "Notes"]
    rows = [
        ("MFC-P-01", "Patent", "Self-aligning stem seal for electric valve actuators", "United Kingdom", "Granted", date(2017, 6, 12), TARGET, date(2037, 6, 12), "Used in all MF-Series actuators"),
        ("MFC-P-02", "Patent", "Self-aligning stem seal for electric valve actuators", "European patent, validated in 4 states", "Granted", date(2018, 6, 11), TARGET, date(2038, 6, 11), "Annuities paid to 2027"),
        ("MFC-P-03", "Patent application", "Retrofit adapter for legacy pneumatic valves", "United Kingdom", "Pending, examination report answered", date(2025, 2, 3), TARGET, None, "Basis of the retrofit programme"),
        ("MFC-D-01", "Registered design", "MF-Series actuator housing", "United Kingdom", "Registered", date(2019, 9, 2), TARGET, date(2029, 9, 2), "Renewable to 2044"),
        ("MFC-T-01", "Trade mark (word)", "MERROFLO", "United Kingdom", "Registered", date(2003, 5, 20), TARGET, date(2033, 5, 20), "Classes 7 and 9"),
        ("MFC-T-02", "Trade mark (word)", "MERROFLO", "European Union", "Registered", date(2012, 8, 14), TARGET, date(2032, 8, 14), "Classes 7 and 9"),
        ("MFC-T-03", "Trade mark (logo)", "Merrow wave device", "United Kingdom", "Registered", date(2016, 3, 1), "Founder (personal name)", date(2026, 3, 1), "Owned by a founder personally; renewal overdue; assignment to the company required"),
        ("MFC-S-01", "Software", "Actuator firmware v4", "Not registered", "Copyright", date(2021, 1, 1), TARGET, None, "Developed in house; one contractor module, IP assigned by contract"),
        ("MFC-L-01", "Licence in", "Valve sizing software", "Worldwide", "Annual subscription", date(2024, 4, 1), "Third party", date(2027, 3, 31), "Standard terms, assignable on change of control"),
        ("MFC-W-01", "Domain name", "merrow-flow.example", "Global", "Registered", date(2004, 1, 15), TARGET, date(2027, 1, 15), ""),
    ]
    write_sheet(
        ws,
        f"Intellectual property register - {TARGET}",
        "Prepared by the company. Official filing numbers are available in the full register on request.",
        header,
        rows,
        [10, 16, 34, 20, 18, 11, 18, 14, 34],
    )
    wb.properties.creator = TARGET
    wb.save(OUT / "ip-register.xlsx")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    information_memorandum()
    financial_summary()
    lease()
    employment_policies()
    customer_contracts()
    ip_register()
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:40} {f.stat().st_size:>8} bytes")
