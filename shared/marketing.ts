export const siteUrl = "https://ragpulse.dev"
export const repositoryUrl = "https://github.com/ramadasnet/ragpulse"
export const documentationUrl = repositoryUrl + "#readme"
export const mcpDocumentationUrl = repositoryUrl + "#mcp"

export const home = {
    path: "/",
    title: "RAGPulse | Self-hosted AI customer support chat",
    description: "Self-host AI support chat with RAGPulse. Answer from your docs, hand off to your team, or connect your own AI agent to support workflows through MCP."
}

export const comparisonHub = {
    path: "/compare",
    title: "Compare AI support chat tools | RAGPulse",
    description: "Compare self-hosted RAGPulse and its MCP server with the managed agents, ready-made connectors and support workflows of six popular tools."
}

export const mcpSupport = {
    id: "mcp-first-support",
    title: "MCP-first support: your agent connects the tools",
    summary:
        "The RAGPulse dashboard covers day-to-day support: review conversations, answer escalations, and manage FAQs and sources. Its Model Context Protocol (MCP) server lets your own AI agent use those same workflows alongside other tools you give it access to. RAGPulse does not need to connect directly to those tools or ship a connector for each one.",
    setup: "Configure a compatible MCP client for the RAGPulse admin endpoint, give it a personal token scoped to the projects and permissions it needs, and configure separate access to any other tools. You choose what the agent can read or write and when a person must approve an action. If you want someone else to manage the agent and integrations, a hosted platform’s ready-made connectors are usually simpler.",
    prompt: "RAGPulse also provides the answer_unanswered_questions MCP prompt for guided escalation triage.",
    tools: [
        {area: "Projects and reporting", names: ["list_projects", "get_project", "get_project_stats"], detail: "Find projects you can access, read settings and retrieve activity statistics."},
        {area: "Escalations", names: ["list_unanswered_questions", "reply_to_question", "dismiss_question"], detail: "Review the queue with conversation context, answer a visitor, or dismiss and reopen a question."},
        {area: "Conversations", names: ["list_sessions", "get_session", "send_session_message", "finish_session"], detail: "Read transcripts, post to active chats, claim handling on open escalations, and finish or reopen sessions."},
        {area: "Knowledge retrieval", names: ["search_knowledge", "get_document"], detail: "Search the same index the chat uses and read the underlying indexed documents."},
        {area: "FAQ maintenance", names: ["list_faqs", "add_faq", "update_faq", "delete_faq"], detail: "Curate reusable answers; changes to FAQs update the search index."},
        {area: "Source sync", names: ["list_sources", "trigger_sync"], detail: "Inspect existing sources and queue one or all for re-sync. Add or configure sources in the dashboard."}
    ],
    example: [
        "An admin starts a triage run in an MCP-capable client such as Claude or Cursor. The agent lists open escalations and skips conversations a teammate is already handling.",
        "The agent reads the session and searches the project’s indexed docs. If the docs don’t answer the question, it can draft an issue using a separately configured issue tracker tool and leave the escalation open.",
        "Once an answer is documented and approved, the agent replies through RAGPulse and adds or updates a general FAQ entry if it is reusable and contains no visitor-specific details."
    ]
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
        answer: "An authorized MCP client can view project statistics, triage escalations, read and reply to conversations, search the knowledge base, maintain FAQs and trigger source sync. Access is limited by the user’s permissions and any scope set on the personal API token."
    },
    {
        question: "Can I connect RAGPulse to a tool without a native connector?",
        answer: "Yes, if your AI agent or automation can access both systems. Connect the agent to RAGPulse over MCP and configure access to the other tool separately. The agent coordinates the workflow; RAGPulse does not need credentials for that tool or a direct connection to it. Managed platforms can be simpler if your team prefers ready-made connectors."
    },
    {
        question: "Do I need to run an external AI agent to use RAGPulse?",
        answer: "No. The dashboard, embeddable AI chat, escalation inbox and knowledge management work without an external MCP client. Connect your own agent if you want to automate admin workflows or coordinate support with other tools."
    },
    {
        question: "What does it take to self-host RAGPulse?",
        answer: "To self-host RAGPulse, run the provided Docker images or build the repository, connect MongoDB, and configure models for chat and embeddings. You operate the deployment and cover any infrastructure and model-provider costs."
    }
]

export const comparisonRows = [
    {key: "agent", topic: "Who runs the agent workflow?", ragpulse: "Your team defines the workflow in its own MCP-capable agent. The dashboard works without an external agent."},
    {key: "connectors", topic: "Ready-made connectors", ragpulse: "Built-in ingestion for websites, Git and Google Drive. For cross-tool workflows, connect your agent to both systems rather than installing a RAGPulse-specific connector."},
    {key: "hosting", topic: "Hosting and data control", ragpulse: "Self-host the single-tenant application and choose the MongoDB deployment for chats, indexed content and vectors. Your team owns uptime, backups and upgrades."},
    {key: "knowledge", topic: "Knowledge sources", ragpulse: "Index website pages, Git docs and optional code summaries, Google Drive folders and FAQ pairs. Supported sources can include PDFs and Office files."},
    {key: "sync", topic: "Sync and citations", ragpulse: "Schedule source refreshes or trigger sync manually or over MCP. Unchanged content is not re-embedded. Chat answers can link to retrieved sources."},
    {key: "channels", topic: "Visitor channels", ragpulse: "Website chat, plus email follow-up for missed replies when a visitor leaves an address and SMTP is configured. Not an omnichannel inbox."},
    {key: "widget", topic: "Website embed", ragpulse: "Floating JavaScript launcher or inline iframe, with project branding and a host allowlist (the project website and allowed domains)."},
    {key: "handoff", topic: "Human handoff", ragpulse: "The dashboard or an authorized MCP client can take over an open escalation and pause automated chat replies while a person handles it."},
    {key: "escalations", topic: "Escalation workflow", ragpulse: "Unanswered questions or requests for a person go to the project’s queue. Notify the team by configured email or webhook; reply, dismiss or reopen in the dashboard or over MCP."},
    {key: "learning", topic: "FAQ learning", ragpulse: "Eligible resolution answers and finished conversations can create reusable FAQ entries. The team or an agent can edit or remove them."},
    {key: "api", topic: "MCP, API and webhooks", ragpulse: "Use the token-authenticated MCP server for support operations, the admin API for programmatic access, or an escalation webhook to push events to an HTTP endpoint."},
    {key: "models", topic: "Model and provider choice", ragpulse: "Configure chat and embedding models with supported providers or a compatible custom endpoint. Content needed for inference or embedding goes to the provider you configure."},
    {key: "setup", topic: "Setup and ideal team", ragpulse: "Best for teams that can operate the Docker deployment, MongoDB and AI providers, and want control over agent permissions and automation."}
] as const

const reviewed = "2026-11-25"

type Comparison = {
    slug: string
    name: string
    category: string
    description: string
    verdict: string
    strengths: [string, string, string]
    fit: string[]
    cells: Record<(typeof comparisonRows)[number]["key"], string>
    reviewed: string
    sources: {label: string; url: string}[]
}

export const comparisons: Comparison[] = [
    {
        slug: "chatbase",
        name: "Chatbase",
        category: "Hosted AI agents",
        description: "Compare RAGPulse and Chatbase for AI customer support: self-hosted documentation chat and MCP versus hosted AI agents for support and sales.",
        verdict:
            "Choose RAGPulse if your own agent should coordinate support with engineering or internal tools through MCP. Choose Chatbase if your team wants to configure a hosted customer-facing agent with ready-made channels and business integrations.",
        strengths: [
            "Run the chat application and choose the MongoDB instance that stores conversations and the search index.",
            "Index Git documentation and optional code summaries alongside your public help pages, so technical answers can link to the relevant sources.",
            "Let an agent triage the support inbox, check a separate issue tracker, and update the FAQ without a direct integration between the tracker and RAGPulse."
        ],
        fit: [
            "Chatbase is a better fit when a support or growth team wants to build and manage its customer-facing agent without running infrastructure or orchestrating a separate AI client. Its Shopify integration, for example, can install the chat bubble and pair with actions for store tasks.",
            "Consider Chatbase if you want the same agent to serve support, sales or product guidance across a website and channels such as WhatsApp. Check which connectors need an additional action and whether the available handoff matches your support workflow."
        ],
        cells: {
            agent: "Build and configure a customer-facing agent inside Chatbase; the platform runs it.",
            connectors: "Ready-made options include Shopify and Slack, plus helpdesk and escalation integrations. Some require configuring a matching action.",
            hosting: "Managed agent platform; no chat infrastructure for your team to maintain.",
            knowledge: "Train the agent on files, text, website pages, Q&A, Notion, tickets or Zendesk macros.",
            sync: "Chatbase documents resyncing a website and syncing changes to imported Notion pages. Confirm how source links appear in your visitor channels.",
            channels: "Website, WhatsApp and phone are among its documented channels.",
            widget: "Copy a web widget or iframe embed. Shopify can install the chat bubble without pasting a script.",
            handoff: "Configure a human handoff when the hosted agent needs help.",
            escalations: "Connect a helpdesk or escalation destination and configure the relevant actions.",
            learning: "Manage Q&A training entries and use usage insights to see what customers ask about.",
            api: "Configure actions inside the agent builder and use Chatbase’s event or helpdesk webhooks where appropriate.",
            models: "Choose per-agent chat models inside the hosted builder, with documented options from providers including OpenAI and Anthropic.",
            setup: "Good for support, growth and product teams that prefer to configure rather than operate the agent stack."
        },
        reviewed,
        sources: [
            {label: "Chatbase product overview", url: "https://www.chatbase.co/"},
            {label: "Chatbase integrations", url: "https://www.chatbase.co/docs/user-guides/integrations"},
            {label: "Chatbase source types and sync", url: "https://www.chatbase.co/docs/user-guides/chatbot/data-sources"},
            {label: "Chatbase webhooks", url: "https://www.chatbase.co/docs/user-guides/chatbot/settings#webhooks"},
            {label: "Chatbase model choice", url: "https://www.chatbase.co/docs/user-guides/chatbot/models-comparison"}
        ]
    },
    {
        slug: "chatlab",
        name: "ChatLab",
        category: "No-code support automation",
        description: "Compare RAGPulse and ChatLab for AI support: a self-hosted Git- and Drive-backed chat versus a no-code platform for messaging and voice.",
        verdict: "Choose RAGPulse if your own agent should work across support, technical docs and the tools you choose. Choose ChatLab if a non-technical team wants a visual agent builder with ready-made commerce and messaging connections.",
        strengths: [
            "Run the widget and support inbox against your configured database in a single-tenant deployment.",
            "Keep Git and Google Drive sources in sync without re-uploading files as the documentation changes.",
            "Give an agent access to RAGPulse through MCP and to the other systems separately; its workflow is not tied to a ChatLab flow or a RAGPulse connector."
        ],
        fit: [
            "ChatLab is better suited to a support team that wants to build and publish agents without a developer. Its Flow Editor lets teams draw steps such as booking or lead qualification, while connectors for Shopify and WooCommerce can support product or order questions.",
            "If phone, WhatsApp or other messaging channels are a requirement, ChatLab offers those alongside web chat and human handover. It is a more direct fit if you want those channels managed in one product rather than configured in your own agent."
        ],
        cells: {
            agent: "Configure hosted agents, guided conversations and actions in a visual editor.",
            connectors: "Ready-made connections include Shopify, WooCommerce and messaging platforms; custom API actions are also available.",
            hosting: "Hosted, no-code agent platform.",
            knowledge: "Train on websites, documents and FAQs.",
            sync: "Advertises automatically refreshed knowledge. Check how refresh and source links behave for your sources and channels.",
            channels: "Web chat, phone, WhatsApp and other messaging channels, with email assistance.",
            widget: "Publish an embeddable website chatbot from the builder.",
            handoff: "Hand over with conversation context so someone on your team can step in.",
            escalations: "Review handovers and unanswered questions in ChatLab’s support workflows.",
            learning: "Use visibility into unanswered questions to spot gaps and update the agent’s knowledge.",
            api: "Visual flows and actions can use ready-made integrations or your own API.",
            models: "Evaluate the platform’s hosted AI and voice settings against any provider requirements.",
            setup: "Well suited to non-technical teams that want visual workflows and multiple customer channels."
        },
        reviewed,
        sources: [{label: "ChatLab product overview", url: "https://www.chatlab.com/"}]
    },
    {
        slug: "intercom-fin",
        name: "Intercom Fin",
        category: "AI for existing helpdesks",
        description: "Compare RAGPulse and Intercom Fin: self-hosted website support and MCP versus a managed AI agent that works with existing helpdesks.",
        verdict: "Choose RAGPulse to run a standalone support chat and let your own agent coordinate with other tools. Choose Fin for a managed agent that works with the helpdesk and routing your team already uses.",
        strengths: [
            "Launch with a website widget and escalation inbox without adopting a separate helpdesk first.",
            "Choose where to store conversations and retrieval data, and configure your own chat and embedding models.",
            "Let a client use project docs indexed from Git and apply your own rules for which escalations to answer or route elsewhere."
        ],
        fit: [
            "Fin is a better fit when support already runs through Intercom or a supported helpdesk such as Zendesk or Salesforce. Keeping existing assignment and escalation workflows can matter more than running a separate chat service.",
            "Fin can run multi-step support procedures with connected systems. It is a strong option if support operations wants to manage the agent and its procedures within an established helpdesk instead of orchestrating a separate AI client."
        ],
        cells: {
            agent: "Fin runs the managed customer-service agent and can execute multi-step procedures.",
            connectors: "Native to Intercom; documented helpdesk integrations include Zendesk, Salesforce, HubSpot and Freshdesk.",
            hosting: "Managed service deployed with Intercom or another supported helpdesk.",
            knowledge: "Uses support knowledge and connected data to answer questions and follow procedures.",
            sync: "Review how Fin ingests and updates your existing help content and what visitors see on each channel.",
            channels: "Uses the channels configured for the Fin and helpdesk setup.",
            widget: "Intercom Messenger is the natural fit for Intercom teams; evaluate setup separately for other helpdesks.",
            handoff: "Fits existing helpdesk routing and assignment so people can continue where Fin stops.",
            escalations: "Work inside the helpdesk’s assignment and escalation processes rather than a separate support inbox.",
            learning: "Evaluate Fin’s analysis and improvement workflow using the helpdesk content your team already maintains.",
            api: "Fin advertises API, MCP and data integrations for its managed agent, as well as helpdesk connectors.",
            models: "Fin describes models built for its service; compare this managed approach with operating your own model stack.",
            setup: "Good for teams that want AI inside an existing service operation without replacing their helpdesk."
        },
        reviewed,
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
        verdict: "Choose RAGPulse for self-hosted technical support and agent-controlled workflows. Choose Tidio if customer chat is also a sales channel and you want managed Shopify and helpdesk features.",
        strengths: [
            "Host the chat and knowledge index yourself instead of adopting a managed commerce support suite.",
            "Connect Git, websites and Google Drive to keep technical answers traceable to their source.",
            "Have your own agent coordinate technical escalations with other tools or turn eligible resolutions into FAQs."
        ],
        fit: [
            "Tidio is a better fit for a Shopify store that wants proactive chat, product recommendations and customer support together. The ready-made Shopify connection and Lyro’s commerce features are more direct than building store workflows yourself.",
            "If the team already uses Tidio’s helpdesk and wants staff to handle exceptions there, keeping that workflow may matter more than choosing database and model providers."
        ],
        cells: {
            agent: "Lyro is the hosted AI agent; Tidio provides the helpdesk, chat and sales workflows.",
            connectors: "Shopify automation comes ready-made. Tidio also lists helpdesk integrations for Lyro, including Zendesk and Intercom.",
            hosting: "Managed customer support and sales platform.",
            knowledge: "Lyro uses support knowledge to answer customer questions and can draw on store information in supported setups.",
            sync: "Check how the connected store and support knowledge refresh, along with answer-source visibility for each channel.",
            channels: "Website live chat and email resolution are part of the product’s support offering.",
            widget: "Install Tidio on Shopify from the app or use the website live chat offering.",
            handoff: "Human operators continue in Tidio’s helpdesk.",
            escalations: "Use helpdesk queues and Smart Redirections to route conversations to the team.",
            learning: "Review Lyro’s answers and manage support knowledge in Tidio’s workflow.",
            api: "Lyro Smart Actions and Shopify automations cover common commerce tasks within the platform.",
            models: "Tidio operates Lyro’s AI stack. Teams configure support content, guidance and behavior inside Lyro.",
            setup: "Best for store teams that want support and proactive selling in one managed product."
        },
        reviewed,
        sources: [
            {label: "Tidio and Lyro product overview", url: "https://www.tidio.com/"},
            {label: "Tidio Shopify integration", url: "https://www.tidio.com/integrations/shopify/"},
            {label: "Lyro AI Agent and integrations", url: "https://www.tidio.com/ai-agent/"}
        ]
    },
    {
        slug: "crisp",
        name: "Crisp",
        category: "Shared messaging inbox",
        description: "Compare RAGPulse and Crisp: self-hosted AI chat with Git, citations and MCP versus a hosted shared inbox with CRM and multichannel messaging.",
        verdict: "Choose RAGPulse if your own agent should connect support with technical knowledge and internal tools. Choose Crisp for a managed multichannel inbox, customer profiles and ready-made integrations.",
        strengths: [
            "Operate a support instance and database for your own organization while keeping multiple project knowledge bases separate.",
            "Index Git repositories and Drive folders alongside help pages so support can keep pace with technical changes.",
            "Give your own agent access to the support inbox and knowledge base over MCP, alongside tools it already uses."
        ],
        fit: [
            "Crisp is better suited to a team that wants web chat, customer profiles and inbound messages in one shared inbox. Agents can work with the same customer context instead of moving between chat and a separate CRM.",
            "Use its catalog if your team wants a ready-made integration, such as Shopify, or visual workflows that a support lead can manage. If you want your own agent to decide how to coordinate with internal developer tools, RAGPulse gives you a different starting point."
        ],
        cells: {
            agent: "Configure the AI agent and workflows inside Crisp.",
            connectors: "Crisp’s integration catalog includes Shopify and CRM services such as Microsoft Dynamics 365.",
            hosting: "Hosted support, messaging and customer data platform.",
            knowledge: "Train on answer snippets, help articles, website crawls, imported files and conversation history.",
            sync: "Check how your chosen sources refresh and how links appear in AI replies.",
            channels: "Website chat and other messaging channels feed a shared inbox.",
            widget: "Crisp provides a website chat widget for support and sales.",
            handoff: "Teammates can continue a conversation from the shared inbox with customer context.",
            escalations: "Use Crisp’s shared inbox and internal workflows to coordinate the team’s response.",
            learning: "Conversation history can be a training source alongside maintained snippets and help center articles.",
            api: "Visual AI workflows, automated internal tasks and a catalog of third-party apps.",
            models: "Evaluate the options Crisp exposes for its managed AI workflows.",
            setup: "Good for support and sales teams that share an inbox across channels."
        },
        reviewed,
        sources: [
            {label: "Crisp product overview", url: "https://crisp.chat/en/"},
            {label: "Crisp integrations", url: "https://crisp.chat/en/integrations/"},
            {label: "Crisp AI knowledge sources", url: "https://crisp.chat/en/ai/"}
        ]
    },
    {
        slug: "zendesk-ai",
        name: "Zendesk AI",
        category: "AI for service desks",
        description: "Compare RAGPulse and Zendesk AI: self-hosted support chat and technical knowledge indexing versus AI agents and Copilot for ticket-based support.",
        verdict: "Choose RAGPulse for self-hosted website support that your own agent can coordinate over MCP. Choose Zendesk AI if support already runs on Zendesk tickets, routing and the agent workspace.",
        strengths: [
            "Run an embeddable chat and escalation inbox without migrating into a ticketing suite.",
            "Index Git code and documentation, websites and Google Drive in the MongoDB database you configure.",
            "Use project-scoped agent access to answer escalations and maintain FAQs without moving the workflow into a ticketing suite."
        ],
        fit: [
            "Zendesk AI is a better fit for service teams that already depend on Zendesk’s ticket queues, help center and agent workspace. AI agents can answer customer inquiries while Copilot helps teammates in their existing workspace.",
            "If your team needs structured routing and ticket operations, using the built-in platform and marketplace integrations can be simpler than adding website chat and coordinating a separate agent. A team without a ticketing suite may prefer RAGPulse’s lighter inbox and choose separately which tools to connect."
        ],
        cells: {
            agent: "Zendesk’s AI agents handle customer requests; Copilot assists human agents in the workspace.",
            connectors: "Native to the Zendesk support ecosystem, with marketplace apps and documented API integrations.",
            hosting: "Managed AI within Zendesk’s service platform.",
            knowledge: "AI agents use connected knowledge to respond to customer inquiries.",
            sync: "Evaluate how AI agents use your help center and connected content, including refresh and channel behavior.",
            channels: "Works within Zendesk’s supported service channels and routing.",
            widget: "Zendesk offers website messaging through its Web Widget.",
            handoff: "Route conversations to human agents in the Zendesk workspace.",
            escalations: "Use ticket queues, assignment and routing rules to continue support requests.",
            learning: "Use help center and AI agent content management to maintain answers in your service operations.",
            api: "Configure AI agent actions and connected workflows around Zendesk’s ticketing and API integrations.",
            models: "Use managed Zendesk AI capabilities; assess the available configuration for your requirements.",
            setup: "A good fit for established service desks that want AI inside their ticketing and routing workflows."
        },
        reviewed,
        sources: [
            {label: "About Zendesk AI agents", url: "https://support.zendesk.com/hc/en-us/articles/6970583409690-About-AI-agents"},
            {label: "About Zendesk Copilot", url: "https://support.zendesk.com/hc/en-us/articles/5524125586330-About-Zendesk-Copilot"},
            {label: "Zendesk Marketplace", url: "https://www.zendesk.com/marketplace/"}
        ]
    }
]

export const comparisonPath = (slug: string) => `${comparisonHub.path}/${slug}`
export const marketingPaths = [home.path, comparisonHub.path, ...comparisons.map(({slug}) => comparisonPath(slug))]
