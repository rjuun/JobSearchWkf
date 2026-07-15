/**
 * Builds a clean 2-page CV (.docx) from a structured model. The blueprint's
 * production path is docxtemplater filling the owner's existing template; for
 * the prototype we generate programmatically with `docx` — fully reliable, no
 * binary template to re-tag. The 2-page constraint is enforced as a content
 * budget upstream (C6), not by measuring pages.
 */
import { Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle } from 'docx';

const ACCENT = '0F7D5A'; // M7 · proof green (was indigo) — the generated CV wears the brand
const GREY = '64748B';

export type CvModel = {
  name: string;
  contact: string;
  profile: string;
  skills: Array<{ category: string; items: string[] }>;
  experience: Array<{ heading: string; bullets: string[] }>;
  education: string[];
  languages: string[];
};

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 90 },
    border: { bottom: { color: 'CBD5E1', size: 6, style: BorderStyle.SINGLE, space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, color: ACCENT, size: 22, characterSpacing: 12 })],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 50 }, children: [new TextRun({ text, size: 20 })] });
}

export async function buildCv(m: CvModel): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: m.name, bold: true, size: 40 })] }),
    new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: m.contact, color: GREY, size: 18 })] }),
  ];

  if (m.profile) {
    children.push(sectionHeading('Profile'));
    children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: m.profile, size: 20 })] }));
  }

  if (m.skills.length) {
    children.push(sectionHeading('Core Skills'));
    for (const cat of m.skills) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: `${cat.category}: `, bold: true, size: 20 }),
            new TextRun({ text: cat.items.join(' · '), size: 20 }),
          ],
        })
      );
    }
  }

  if (m.experience.length) {
    children.push(sectionHeading('Professional Experience'));
    for (const exp of m.experience) {
      children.push(
        new Paragraph({ spacing: { before: 100, after: 40 }, children: [new TextRun({ text: exp.heading, bold: true, size: 21 })] })
      );
      for (const b of exp.bullets) children.push(bullet(b));
    }
  }

  if (m.education.length) {
    children.push(sectionHeading('Education'));
    for (const e of m.education) children.push(new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: e, size: 20 })] }));
  }

  if (m.languages.length) {
    children.push(sectionHeading('Languages'));
    children.push(new Paragraph({ children: [new TextRun({ text: m.languages.join('  ·  '), size: 20 })] }));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 864, right: 864 } } },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
