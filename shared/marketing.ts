export const siteUrl = "https://ragpulse.dev"
export const repositoryUrl = "https://github.com/ramadasnet/ragpulse"
export const documentationUrl = repositoryUrl + "#readme"

export const home = {
    path: "/",
    title: "RAGPulse | Self-hosted AI customer support chat",
    description: "RAGPulse is self-hosted AI support chat that answers from your websites, Git repositories, Google Drive and FAQs, with human takeover and an MCP server."
}

export const comparisonHub = {
    path: "/compare",
    title: "Compare AI support chat tools | RAGPulse",
    description: "Compare RAGPulse with Chatbase, ChatLab, Intercom Fin, Tidio, Crisp and Zendesk AI by hosting, knowledge sources and human handoff."
}

export const faq = [
    {
        question: "What is RAGPulse?",
        answer: "RAGPulse is a self-hosted AI support chat that answers customer questions using your own documentation. It comes with an embeddable chat widget, a support inbox and a Model Context Protocol (MCP) server."
    },
    {
        question: "What knowledge sources can RAGPulse use?",
        answer: "RAGPulse indexes FAQs, websites, Git repositories and Google Drive folders. It can extract text from PDFs and Office documents found in supported sources and can optionally use a vision model for images and scanned PDFs. Chat answers show links to the sources they used."
    },
    {
        question: "Where does RAGPulse store knowledge and conversations?",
        answer: "RAGPulse stores indexed knowledge, embeddings and conversations in the MongoDB database you configure. You choose where to run the single-tenant application and which AI providers to use. If you configure external AI providers, the content needed for embedding or inference is sent to those providers."
    },
    {
        question: "Can a human take over from the AI?",
        answer: "Yes. Unanswered questions and requests for a human go to an escalation inbox. When a team member takes over an open escalation, AI replies pause. When SMTP is configured, the team can follow up by email if the visitor misses the reply."
    },
    {
        question: "Does RAGPulse learn from support conversations?",
        answer: "Yes. RAGPulse can turn reusable answers and finished conversations with human replies into FAQ entries. Escalations identified as user-specific are excluded from FAQ learning, and learned conversation summaries are scrubbed of personal information."
    },
    {
        question: "What can an MCP client do with RAGPulse?",
        answer: "An authorized MCP client can work with support conversations, escalated questions and project knowledge through RAGPulse’s MCP server. It uses a scoped personal API token, so access depends on the token’s permissions."
    },
    {
        question: "What does it take to self-host RAGPulse?",
        answer: "To self-host RAGPulse, run the provided Docker images or build the repository, connect MongoDB, and configure models for chat and embeddings. You operate the deployment and cover any infrastructure and model-provider costs."
    }
]

export const comparisonRows = [
    {topic: "Deployment", ragpulse: "Self-hosted, single-tenant application. Your team handles upgrades, uptime and backups."},
    {topic: "Knowledge", ragpulse: "Sync websites, Git repositories (including optional code summaries), Google Drive folders and FAQs. Answers link to sources."},
    {topic: "Support workflow", ragpulse: "Embeddable website chat, escalation inbox, human takeover and email follow-up with SMTP configured."},
    {topic: "Automation", ragpulse: "Token-authenticated MCP server, escalation webhooks and FAQ learning from eligible human resolutions."}
] as const

type Comparison = {
    slug: string
    name: string
    category: string
    description: string
    verdict: string
    strengths: [string, string, string]
    fit: string
    cells: [string, string, string, string]
    reviewed: string
    sources: {label: string; url: string}[]
}

export const comparisons: Comparison[] = [
    {
        slug: "chatbase",
        name: "Chatbase",
        category: "Hosted AI agents",
        description: "Compare RAGPulse and Chatbase for AI customer support: self-hosted documentation chat and MCP versus hosted AI agents for support and sales.",
        verdict: "Choose RAGPulse if you want to run documentation-backed support chat on your own infrastructure. Choose Chatbase if you want a hosted agent builder that works across customer support, sales and product guidance.",
        strengths: [
            "Run the chat application and choose the MongoDB instance that stores conversations and the search index.",
            "Index Git documentation and optional code summaries alongside your public help pages, so technical answers can link to the relevant sources.",
            "Use the support inbox yourself or let authorized MCP clients work with escalations and project knowledge."
        ],
        fit: "Chatbase is a better fit if a non-engineering team wants to launch a managed agent and connect it to business tools without operating the underlying service. Its focus on support, sales and product guidance is useful if the agent needs to do more than answer documentation questions.",
        cells: [
            "Hosted agent platform, with no chat infrastructure for your team to maintain.",
            "Train an agent on business content for customer-facing answers.",
            "Deploy across customer channels and hand conversations to humans when needed.",
            "Configure agents to take actions in connected tools."
        ],
        reviewed: "2026-11-24",
        sources: [{label: "Chatbase product overview", url: "https://www.chatbase.co/"}]
    },
    {
        slug: "chatlab",
        name: "ChatLab",
        category: "No-code support automation",
        description: "Compare RAGPulse and ChatLab for AI support: a self-hosted Git- and Drive-backed chat versus a no-code platform for messaging and voice.",
        verdict: "Choose RAGPulse if you want to own the deployment and keep answers in sync with engineering documentation. Choose ChatLab if your team needs a no-code agent across web chat, phone and messaging.",
        strengths: [
            "Run the widget and support inbox against your configured database in a single-tenant deployment.",
            "Keep Git and Google Drive sources in sync without re-uploading files as the documentation changes.",
            "Handle exceptions with human takeover or an MCP client, and reuse eligible human answers as FAQs."
        ],
        fit: "ChatLab is better suited to a support team that wants to publish agents without a developer. Its visual Flow Editor can guide steps such as bookings or qualification, and its phone and messaging channels suit teams that do not want to limit support to their website.",
        cells: ["Hosted, no-code agent platform.", "Train on websites, documents and FAQs with automated refresh.", "Web chat, phone and messaging channels with human handover.", "Visual Flow Editor and actions in connected systems."],
        reviewed: "2026-11-24",
        sources: [{label: "ChatLab product overview", url: "https://www.chatlab.com/"}]
    },
    {
        slug: "intercom-fin",
        name: "Intercom Fin",
        category: "AI for existing helpdesks",
        description: "Compare RAGPulse and Intercom Fin: self-hosted website support and MCP versus a managed AI agent that works with existing helpdesks.",
        verdict: "Choose RAGPulse for a standalone support chat you run yourself. Choose Fin if you already have a helpdesk workflow and want a managed AI agent working within it.",
        strengths: [
            "Launch with a website widget and escalation inbox without adopting a separate helpdesk first.",
            "Choose where to store conversations and retrieval data, and configure your own chat and embedding models.",
            "Index a technical project directly from Git, including documentation and optional code summaries."
        ],
        fit: "Fin is a better fit when support already runs through Intercom or another supported helpdesk. You can keep existing assignment and escalation workflows instead of moving agents to a new inbox. Fin is natively integrated with Intercom and also lists integrations with helpdesks such as Zendesk and Salesforce.",
        cells: [
            "Managed AI agent, native to Intercom and available with supported external helpdesks.",
            "Uses support knowledge and connected data to resolve customer questions.",
            "Fits existing helpdesk assignment, routing and escalation workflows.",
            "Can carry out actions and multi-step support procedures using connected systems."
        ],
        reviewed: "2026-11-24",
        sources: [
            {label: "Fin for Service", url: "https://fin.ai/service"},
            {label: "Fin helpdesk integrations", url: "https://fin.ai/integrations/helpdesk"}
        ]
    },
    {
        slug: "tidio",
        name: "Tidio",
        category: "E-commerce chat and AI",
        description: "Compare RAGPulse and Tidio Lyro for support chat: self-hosted technical answers versus hosted e-commerce chat, AI and sales automation.",
        verdict: "Choose RAGPulse for documentation-heavy support where deployment control matters. Choose Tidio if customer chat is also a sales channel for your online store.",
        strengths: [
            "Host the chat and knowledge index yourself instead of adopting a managed commerce support suite.",
            "Connect Git, websites and Google Drive to keep technical answers traceable to their source.",
            "Route unresolved questions to your team and turn eligible resolutions into reusable FAQ entries."
        ],
        fit: "Tidio is a better fit for online stores that want proactive chat, product recommendations and lead capture alongside support. Lyro works alongside Tidio’s helpdesk and sales features, making it useful when your team values commerce workflows more than controlling the chat deployment.",
        cells: [
            "Hosted platform combining AI, live chat and helpdesk tools.",
            "Lyro uses support knowledge to answer customer questions.",
            "Helpdesk for human follow-up; proactive messaging supports sales as well as service.",
            "Lyro Smart Actions and commerce-oriented features such as product recommendations."
        ],
        reviewed: "2026-11-24",
        sources: [{label: "Tidio and Lyro product overview", url: "https://www.tidio.com/"}]
    },
    {
        slug: "crisp",
        name: "Crisp",
        category: "Shared messaging inbox",
        description: "Compare RAGPulse and Crisp: self-hosted AI chat with Git, citations and MCP versus a hosted shared inbox with CRM and multichannel messaging.",
        verdict: "Choose RAGPulse if your priority is source-backed answers for a product or documentation site. Choose Crisp if your team needs a shared inbox and customer information across messaging channels.",
        strengths: [
            "Operate a support instance and database for your own organization while keeping multiple project knowledge bases separate.",
            "Index Git repositories and Drive folders alongside help pages so support can keep pace with technical changes.",
            "Connect your own MCP clients to support workflows instead of relying solely on an inbox UI."
        ],
        fit: "Crisp is better suited to teams that want multichannel messaging, customer profiles and internal workflows in one place. Its shared inbox and built-in CRM are useful when the team spends more time coordinating across channels than answering from technical docs.",
        cells: [
            "Hosted customer messaging and support platform.",
            "Train an AI agent on business knowledge; users can also search a help center.",
            "Multichannel shared inbox, website widget and built-in CRM.",
            "Visual AI workflows and automated internal tasks."
        ],
        reviewed: "2026-11-24",
        sources: [{label: "Crisp product overview", url: "https://crisp.chat/en/"}]
    },
    {
        slug: "zendesk-ai",
        name: "Zendesk AI",
        category: "AI for service desks",
        description: "Compare RAGPulse and Zendesk AI: self-hosted support chat and technical knowledge indexing versus AI agents and Copilot for ticket-based support.",
        verdict: "Choose RAGPulse for self-hosted website chat without adopting a full ticketing suite. Choose Zendesk AI if your support team already relies on Zendesk tickets, help center content and agent workflows.",
        strengths: [
            "Run an embeddable chat and escalation inbox without migrating into a ticketing suite.",
            "Index Git code and documentation, websites and Google Drive in the MongoDB database you configure.",
            "Give your team and permissioned MCP clients ways to answer escalations and build up project FAQs."
        ],
        fit: "Zendesk AI is a better fit for established Zendesk teams that need AI inside a larger service desk. Its AI agents can automate customer conversations, while Copilot can assist human agents inside their ticket workspace.",
        cells: [
            "AI features delivered within the Zendesk service platform.",
            "AI agents can use connected knowledge to respond to customer inquiries.",
            "Designed around Zendesk’s ticket queue, agent workspace and channel routing.",
            "AI agents handle customer requests; Copilot helps human agents with their work."
        ],
        reviewed: "2026-11-24",
        sources: [
            {label: "About Zendesk AI agents", url: "https://support.zendesk.com/hc/en-us/articles/6970583409690-About-AI-agents"},
            {label: "About Zendesk Copilot", url: "https://support.zendesk.com/hc/en-us/articles/5524125586330-About-Zendesk-Copilot"}
        ]
    }
]

export const comparisonPath = (slug: string) => `${comparisonHub.path}/${slug}`
export const marketingPaths = [home.path, comparisonHub.path, ...comparisons.map(({slug}) => comparisonPath(slug))]
