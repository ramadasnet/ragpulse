import {home, repositoryUrl, siteUrl} from "../../shared/marketing"

type MarketingPage = {path: string; title: string; description: string}

export function useMarketingSeo(page: MarketingPage, graph: Record<string, unknown>[] = []) {
    const url = siteUrl + page.path
    const image = siteUrl + "/admin-overview.webp"
    const imageAlt = "RAGPulse dashboard showing conversation, escalation and knowledge-base metrics"
    useSeoMeta({
        title: page.title,
        description: page.description,
        ogType: "website",
        ogSiteName: "RAGPulse",
        ogLocale: "en_US",
        ogUrl: url,
        ogTitle: page.title,
        ogDescription: page.description,
        ogImage: image,
        ogImageType: "image/webp",
        ogImageWidth: 1920,
        ogImageHeight: 1125,
        ogImageAlt: imageAlt,
        twitterCard: "summary_large_image",
        twitterTitle: page.title,
        twitterDescription: page.description,
        twitterImage: image,
        twitterImageAlt: imageAlt
    })
    useHead({
        link: [{rel: "canonical", href: url}],
        script: [{key: "marketing-json-ld", type: "application/ld+json", innerHTML: JSON.stringify({"@context": "https://schema.org", "@graph": graph}).replace(/</g, "\\u003c")}]
    })
}

export const marketingOrganization = {
    "@type": "Organization",
    "@id": siteUrl + "/#organization",
    name: "Ramadas.net",
    url: "https://ramadas.net"
}

export const marketingWebsite = {
    "@type": "WebSite",
    "@id": siteUrl + "/#website",
    url: siteUrl + "/",
    name: "RAGPulse",
    inLanguage: "en",
    publisher: {"@id": marketingOrganization["@id"]}
}

export const marketingApplication = {
    "@type": "SoftwareApplication",
    "@id": siteUrl + "/#application",
    name: "RAGPulse",
    description: home.description,
    url: siteUrl + "/",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Linux (Docker)",
    sameAs: repositoryUrl,
    publisher: {"@id": marketingOrganization["@id"]},
    screenshot: siteUrl + "/admin-overview.webp",
    featureList: ["Self-hosted AI support chat", "Website, Git and Google Drive indexing", "Embeddable chat widget", "Human takeover", "FAQ learning", "MCP server"]
}

export function marketingBreadcrumbs(...pages: {path: string; name: string}[]) {
    return {
        "@type": "BreadcrumbList",
        itemListElement: [{path: home.path, name: "Home"}, ...pages].map(({path, name}, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name,
            item: siteUrl + path
        }))
    }
}
