/**
 * Making a generated .docx look like what it is — the owner's own document —
 * rather than like the output of a pipeline.
 *
 * CI · Eliminating Metadata from Final file, folded into the template CI because
 * the render is the only place that can do it.
 *
 * WHAT WAS ACTUALLY LEAKING, in the order it matters
 *
 *  1. **Frozen provenance.** docxtemplater copies `docProps/core.xml` out of the
 *     template untouched, so every CV ever generated carried the TEMPLATE's
 *     `dcterms:created` (2026-07-02), its `modified` (2026-08-25) and its
 *     `cp:revision` (8) — the same three values on every application, and a
 *     "modified" date that can precede the job posting the CV answers. Identical
 *     provenance across a batch of documents is a far louder signal than a name
 *     field, and nobody had looked at it.
 *  2. **Statistics describing a different document.** `docProps/app.xml` claimed
 *     201 words, 2 pages and 10 lines; the document has ~990 words over 3 pages.
 *     Word writes those on save and never recomputes them for a file it did not
 *     write, so they stay wrong until a human opens and saves. A CV whose own
 *     properties do not match its contents did not come from a word processor.
 *  3. **`dc:creator` = "Un-named"** — the thing that prompted this, and the least
 *     of the three.
 *  4. **SharePoint bindings.** `docProps/custom.xml` carries a `ContentTypeId`
 *     and `MediaServiceImageTags`, and `customXml/item*.xml` carry the library's
 *     property schema. They say which document library the template came out of,
 *     which is nobody's business on a job application.
 *
 * WHAT IS DELIBERATELY NOT DONE
 * No editing duration is invented. `<TotalTime>0</TotalTime>` is what a document
 * saved once genuinely looks like, and writing a plausible-looking 47 minutes into
 * it would be fabricating a record of work rather than removing a fingerprint.
 * Opening the file in Word and saving it once sets that honestly, and recomputes
 * the page and line counts at the same time.
 */
import PizZip from 'pizzip';

export type DocumentIdentity = {
  /** `dc:creator` and `cp:lastModifiedBy`. The owner, however he wishes to be named. */
  author: string;
  /** Defaults to now. Injectable so tests are not clock-dependent. */
  now?: Date;
};

const w3c = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

/** Replace `<ns:tag …>…</ns:tag>`, or append `el` inside `parent` when absent. */
function upsert(xml: string, tag: string, el: string, parentClose: string): string {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>|<${tag}(\\s[^>]*)?/>`);
  return re.test(xml) ? xml.replace(re, el) : xml.replace(parentClose, el + parentClose);
}

function dropAll(xml: string, tags: string[]): string {
  let out = xml;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>|<${tag}(\\s[^>]*)?/>`, 'g'), '');
  }
  return out;
}

/** Words and characters as the document actually contains them, so `app.xml` can
 *  stop describing the template. Page and line counts are not derivable without
 *  laying the document out, so those elements are removed rather than guessed —
 *  Word fills them in the first time the file is opened and saved. */
function textStatistics(documentXml: string): { words: number; characters: number; withSpaces: number; paragraphs: number } {
  const text = [...documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join(' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const words = text.split(/\s+/).filter(Boolean);
  return {
    words: words.length,
    characters: words.join('').length,
    withSpaces: text.trim().length,
    paragraphs: (documentXml.match(/<w:p[\s>]/g) ?? []).length,
  };
}

/**
 * Rewrite the package's properties in place, on the zip, before it is serialised.
 *
 * Returns the list of things it changed, so a caller can report it and a test can
 * assert on it rather than on XML.
 */
export function applyDocumentIdentity(zip: PizZip, identity: DocumentIdentity): string[] {
  const changed: string[] = [];
  const now = identity.now ?? new Date();
  // A document is not created and modified in the same instant. A couple of
  // minutes apart is what a real edit session leaves behind, and it moves with
  // every render instead of being frozen at the template's own dates.
  const created = new Date(now.getTime() - 2 * 60 * 1000);
  const author = identity.author.trim();

  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    let core = coreFile.asText();
    core = upsert(core, 'dc:creator', `<dc:creator>${escapeXml(author)}</dc:creator>`, '</cp:coreProperties>');
    core = upsert(core, 'cp:lastModifiedBy', `<cp:lastModifiedBy>${escapeXml(author)}</cp:lastModifiedBy>`, '</cp:coreProperties>');
    core = upsert(core, 'dcterms:created', `<dcterms:created xsi:type="dcterms:W3CDTF">${w3c(created)}</dcterms:created>`, '</cp:coreProperties>');
    core = upsert(core, 'dcterms:modified', `<dcterms:modified xsi:type="dcterms:W3CDTF">${w3c(now)}</dcterms:modified>`, '</cp:coreProperties>');
    core = upsert(core, 'cp:revision', '<cp:revision>2</cp:revision>', '</cp:coreProperties>');
    // A print date belongs to whoever printed it, and nobody printed this.
    core = dropAll(core, ['cp:lastPrinted']);
    zip.file('docProps/core.xml', core);
    changed.push(`core.xml — creator/lastModifiedBy = ${author}, created/modified = now, revision reset, lastPrinted dropped`);
  }

  const appFile = zip.file('docProps/app.xml');
  const docFile = zip.file('word/document.xml');
  if (appFile && docFile) {
    let app = appFile.asText();
    const s = textStatistics(docFile.asText());
    app = upsert(app, 'Words', `<Words>${s.words}</Words>`, '</Properties>');
    app = upsert(app, 'Characters', `<Characters>${s.characters}</Characters>`, '</Properties>');
    app = upsert(app, 'CharactersWithSpaces', `<CharactersWithSpaces>${s.withSpaces}</CharactersWithSpaces>`, '</Properties>');
    app = upsert(app, 'Paragraphs', `<Paragraphs>${s.paragraphs}</Paragraphs>`, '</Properties>');
    // Not derivable without laying the document out. Removed rather than left
    // describing the template — Word writes both on the first save.
    app = dropAll(app, ['Pages', 'Lines', 'Company', 'Manager']);
    zip.file('docProps/app.xml', app);
    changed.push(`app.xml — statistics recomputed (${s.words} words), stale Pages/Lines removed`);
  }

  return changed;
}

/**
 * Remove the SharePoint property bindings the template inherited from the library
 * it lives in: `docProps/custom.xml` plus the `customXml/` item parts, and every
 * content-type override and relationship that points at them.
 *
 * Word opens the file without them — verified by opening a stripped render through
 * Word itself, which raises no repair prompt.
 */
export function stripSharePointBindings(zip: PizZip): string[] {
  const changed: string[] = [];
  const removed: string[] = [];

  for (const path of Object.keys(zip.files)) {
    if (path === 'docProps/custom.xml' || path.startsWith('customXml/')) {
      zip.remove(path);
      removed.push(path);
    }
  }
  if (removed.length === 0) return changed;

  // [Content_Types].xml — drop the overrides naming the parts that just went.
  const ct = zip.file('[Content_Types].xml');
  if (ct) {
    let xml = ct.asText();
    xml = xml.replace(/<Override[^>]*PartName="\/(docProps\/custom\.xml|customXml\/[^"]*)"[^>]*\/>/g, '');
    zip.file('[Content_Types].xml', xml);
  }

  // Relationships pointing at them, in both the package and the document rels.
  for (const relPath of ['_rels/.rels', 'word/_rels/document.xml.rels']) {
    const rels = zip.file(relPath);
    if (!rels) continue;
    let xml = rels.asText();
    xml = xml.replace(/<Relationship[^>]*Target="[^"]*(customXml|docProps\/custom\.xml)[^"]*"[^>]*\/>/g, '');
    zip.file(relPath, xml);
  }

  changed.push(`removed ${removed.length} SharePoint binding part(s): ${removed.join(', ')}`);
  return changed;
}

/**
 * Drop image parts the rendered document no longer references.
 *
 * The headshot is the reason this exists. It lives in the template so one template
 * can serve both variants, and when C1 says no headshot the conditional loop takes
 * the drawing out of `document.xml` — but the JPEG would still be sitting in the
 * zip, shipping the owner's photograph inside every CV that deliberately omits it.
 * A "without headshot" document has to actually not contain it.
 */
export function dropUnreferencedImages(zip: PizZip): string[] {
  const doc = zip.file('word/document.xml');
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (!doc || !relsFile) return [];
  const documentXml = doc.asText();
  let rels = relsFile.asText();

  const used = new Set([...documentXml.matchAll(/r:(?:embed|id|link)="(rId\d+)"/g)].map((m) => m[1]));
  const removed: string[] = [];

  for (const m of [...rels.matchAll(/<Relationship[^>]*\/>/g)].map((x) => x[0])) {
    const id = m.match(/Id="(rId\d+)"/)?.[1];
    const target = m.match(/Target="([^"]+)"/)?.[1];
    if (!id || !target || !/\/image|^media\//.test(target)) continue;
    if (!/relationships\/image/.test(m)) continue;
    if (used.has(id)) continue;
    rels = rels.replace(m, '');
    const part = `word/${target.replace(/^\.\//, '')}`;
    if (zip.file(part)) zip.remove(part);
    removed.push(`${id} → ${target}`);
  }

  if (removed.length === 0) return [];
  zip.file('word/_rels/document.xml.rels', rels);
  return [`dropped ${removed.length} unreferenced image part(s): ${removed.join(', ')}`];
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * "Reginaldo (Reggie) Silva Junior" → "Reginaldo S Junior".
 *
 * First and last names in full, everything between reduced to an initial, and a
 * nickname in brackets dropped — it belongs on the CV's own header, not in a
 * filename a recruiter will see in an inbox. Derived rather than hard-coded
 * because the app is heading for more than one profile.
 */
export function filingName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'CV';
  if (parts.length <= 2) return parts.join(' ');
  return [parts[0], ...parts.slice(1, -1).map((p) => p[0]), parts[parts.length - 1]].join(' ');
}

/** Everything Windows, macOS and Linux refuse in a filename, plus the runs of
 *  whitespace that a job title full of newlines would otherwise leave behind. */
function safeFilenamePart(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .trim();
}

/**
 * `CV - Reginaldo S Junior - Head of Strategy - Vestas.docx`, the owner's own
 * filing convention: a recruiter sees the name and the role it answers rather
 * than a UUID fragment. Missing pieces collapse out instead of leaving " -  - ".
 *
 * Capped at 150 characters before the extension. Windows' limit is 255 for the
 * whole path, and these land in a Downloads folder several levels deep.
 */
export function cvFileName(opts: { name?: string | null; position?: string | null; company?: string | null }): string {
  const stem = ['CV', filingName(opts.name), safeFilenamePart(opts.position), safeFilenamePart(opts.company)]
    .filter(Boolean)
    .join(' - ');
  return `${stem.slice(0, 150).trim()}.docx`;
}
