import {comparisonHub, comparisonPath, comparisonRows, comparisons, documentationUrl, faq, home, marketingPaths, mcpSupport, siteUrl} from "../shared/marketing"

export default defineEventHandler((event) => {
    const path = getRequestURL(event).pathname
    if (path === "/sitemap.xml") {
        setHeader(event, "Content-Type", "application/xml; charset=utf-8")
        return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...marketingPaths.map((page) => `    <url><loc>${siteUrl}${page}</loc></url>`), "</urlset>"].join("\n")
    }

    setHeader(event, "Content-Type", "text/plain; charset=utf-8")
    const index = [
        "# RAGPulse",
        `> ${home.description}`,
        "## Product and documentation",
        `- [RAGPulse homepage](${siteUrl}/): How the chat, knowledge retrieval and human handoff work.`,
        `- [Setup and configuration](${documentationUrl}): Docker deployment, MongoDB, AI providers, embedding and MCP.`,
        `- [MCP-first support workflow](${siteUrl}${comparisonHub.path}#${mcpSupport.id}): Bring your own agent to triage escalations and connect tools without a direct integration.`,
        `- [Full text reference](${siteUrl}/llms-full.txt): FAQ and comparison summaries in Markdown.`,
        "## Compare AI support systems",
        `- [Comparison hub](${siteUrl}${comparisonHub.path}): Compare agent-controlled workflows with managed agents and ready-made connectors.`,
        ...comparisons.map(({name, slug, category}) => `- [RAGPulse vs ${name}](${siteUrl}${comparisonPath(slug)}): ${category}.`)
    ].join("\n\n")
    if (path === "/llms.txt") return index

    return [
        index,
        `## ${mcpSupport.title}`,
        mcpSupport.summary,
        mcpSupport.setup,
        "### Example: triage a support escalation",
        ...mcpSupport.example.map((step, i) => `${i + 1}. ${step}`),
        "### What the MCP server exposes",
        ...mcpSupport.tools.map(({area, detail, names}) => `- ${area}: ${detail} Tools: ${names.map((name) => `\`${name}\``).join(", ")}.`),
        mcpSupport.prompt,
        "## Frequently asked questions",
        ...faq.map(({question, answer}) => `### ${question}\n\n${answer}`),
        "## Comparison details",
        ...comparisons.map(({name, slug, verdict, strengths, fit, cells, reviewed, sources}) =>
            [
                `### [RAGPulse vs ${name}](${siteUrl}${comparisonPath(slug)})`,
                verdict,
                ...strengths.map((strength) => `- ${strength}`),
                `When ${name} may be a better fit:`,
                ...fit,
                ...comparisonRows.map(({key, topic, ragpulse}) => `- ${topic}: RAGPulse: ${ragpulse} ${name}: ${cells[key]}`),
                `Last reviewed: ${reviewed}. Sources: ${sources.map(({label, url}) => `[${label}](${url})`).join(", ")}.`
            ].join("\n\n")
        )
    ].join("\n\n")
})
