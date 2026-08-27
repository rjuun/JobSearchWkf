<#
  Page and line budget of a rendered CV, measured by Word itself over COM.

  WHY THIS EXISTS
  `soffice` is not installed here; Word is, and Word is the renderer the CV is
  actually read in. Every space rule in `Process/C7…` §C is a claim about the
  rendered page, and until this existed none of them had ever been checked
  against one — which is how "max 5 lines" and "40 skills" both survived for
  months while the document ran to three pages.

  Pair it with `scripts/render-cv-from-stored.ts`, which rebuilds a lead's CV
  from stored data at no model cost. Together they make every number in the
  space budget free to verify, so there is no excuse for an estimated one.

    powershell -File scripts/cv-pages.ps1 _local/*.docx
    powershell -File scripts/cv-pages.ps1 -Detail _local/cv-69bc2e13.docx

  `-Detail` adds the per-section line cost — Profile, Skills, Professional
  Experience, and the fixed Education/Languages tail — which is what tells you
  WHICH lever to pull, rather than only that the document is over budget.
#>
param(
  [switch]$Detail,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Files
)

if (-not $Files) { Write-Error 'usage: cv-pages.ps1 [-Detail] <file.docx> ...'; exit 1 }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  foreach ($f in $Files) {
    foreach ($resolved in (Resolve-Path $f)) {
      $full = $resolved.Path
      $doc = $word.Documents.Open($full, $false, $true)
      $pages = $doc.ComputeStatistics(2)   # wdStatisticPages
      $lines = $doc.ComputeStatistics(1)   # wdStatisticLines
      $mark = if ($pages -le 2) { 'OK ' } else { 'OVER' }
      Write-Output ("{0}  {1}  {2} pages  {3} lines" -f $mark, (Split-Path $full -Leaf), $pages, $lines)

      if ($Detail) {
        # Section boundaries are the CV's own first-level headings, which print
        # in caps with a leading space. Everything between two of them belongs
        # to the first, so the cost of a section is a subtraction and needs no
        # style knowledge.
        $head = @{}
        $order = @()
        $n = 0
        foreach ($p in $doc.Paragraphs) {
          $n++
          # Control characters, not just CR: every first-level heading carries an
          # inline icon, which reaches the text as U+0001 and defeats a plain Trim.
          $t = ($p.Range.Text -replace '[\x00-\x1F]', '').Trim()
          if ($t -cmatch '^(PROFILE|SKILLS|PROFESSIONAL EXPERIENCE|EDUCATION|EXECUTIVE EDUCATION|LANGUAGES)$') {
            $head[$t] = $p.Range.Information(10)   # wdFirstCharacterLineNumber, page-relative
            $head["$t.page"] = $p.Range.Information(3)
            $order += $t
          }
        }
        # Page-relative line numbers only subtract cleanly within one page, so a
        # section that spans a page break reports as "(spans pages)" rather than
        # a wrong number. The three sections the budget is actually spent on —
        # Profile, Skills, and the fixed tail — never do.
        for ($i = 0; $i -lt $order.Count; $i++) {
          $name = $order[$i]
          if ($i + 1 -lt $order.Count) {
            $next = $order[$i + 1]
            if ($head["$name.page"] -eq $head["$next.page"]) {
              Write-Output ("      {0,-24} {1,3} lines" -f $name, ($head[$next] - $head[$name]))
            } else {
              Write-Output ("      {0,-24}   (spans pages {1}-{2})" -f $name, $head["$name.page"], $head["$next.page"])
            }
          }
        }
        Write-Output ("      {0,-24} {1,3}" -f 'last page ends at line', $doc.ComputeStatistics(1))
      }
      $doc.Close($false)
    }
  }
} finally { $word.Quit() }
