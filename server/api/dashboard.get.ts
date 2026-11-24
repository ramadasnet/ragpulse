import {getDashboard} from "../utils/dashboard"

export default defineEventHandler(async (event) => {
    const user = await requireUser(event)
    return getDashboard(user, await useCollections())
})
