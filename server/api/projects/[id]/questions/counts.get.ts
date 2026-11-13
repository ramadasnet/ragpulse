/** Question counts per status (for inbox tabs). */
export default defineEventHandler(async (event) => {
    const {project} = await requireProjectAccess(event, "questions:reply")
    const {questions} = await useCollections()
    const rows = await questions.aggregate<{_id: string; n: number}>([{$match: {projectId: project._id}}, {$group: {_id: "$status", n: {$sum: 1}}}]).toArray()
    const counts = {open: 0, answered: 0, dismissed: 0, all: 0}
    for (const row of rows) {
        if (row._id in counts) counts[row._id as "open" | "answered" | "dismissed"] = row.n
        counts.all += row.n
    }
    return counts
})
