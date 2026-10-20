// Render one real prompt per builder for user inspection.
// The 75 KB skill body is truncated to a marker so the shape stays readable.
import { render, cleanup } from './_probe-import.mjs'

for (const kind of ['design', 'ingest']) {
  const text = await render(kind)
  // elide the giant skill block so the task structure is what you see
  const shown = text.replace(/<llm-wiki-skill>\n[\s\S]*?\n<\/llm-wiki-skill>/, '<llm-wiki-skill>\n（此处为约 75KB 的 llm-wiki 技能全文，已略）\n</llm-wiki-skill>')
  console.log(`\n${'='.repeat(70)}\n${kind.toUpperCase()} PROMPT（${text.length} 字符，含技能全文）\n${'='.repeat(70)}\n`)
  console.log(shown)
}
cleanup()
