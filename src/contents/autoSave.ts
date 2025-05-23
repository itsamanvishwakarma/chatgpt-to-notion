import type { PlasmoCSConfig } from "plasmo"
import { compress } from "shrink-string"

import { sendToBackground } from "@plasmohq/messaging"
import { Storage } from "@plasmohq/storage"

import { parseSave } from "~api/parseSave"
import { STORAGE_KEYS } from "~utils/consts"
import { getChatConfig, updateChatConfig } from "~utils/functions"
import type { AutosaveStatus, ChatConfig } from "~utils/types"

import { fetchFullChat } from "./fetchFullPage"

export const config: PlasmoCSConfig = {
  matches: ["https://chat.openai.com/*", "https://chatgpt.com/*"]
}

const storage = new Storage()

storage.watch({
  generatingAnswer: async ({ newValue, oldValue }) => {
    const chatID = await storage.get(STORAGE_KEYS.chatID)

    if (newValue == true && oldValue == false) {
      updateChatConfig(chatID, { lastSaveStatus: "generating" })
      storage.set(STORAGE_KEYS.autosaveStatus, "generating" as AutosaveStatus)
    } else if (newValue == false && oldValue == true) {
      try {
        const [isPremium, activeTrial] = await Promise.all([
          storage.get(STORAGE_KEYS.isPremium),
          storage.get(STORAGE_KEYS.activeTrial)
        ])
        if (!(isPremium || activeTrial)) return

        const config = await getChatConfig(chatID)
        if (!config || !config.enabled) return

        storage.set(STORAGE_KEYS.autosaveStatus, "saving" as AutosaveStatus)

        const database = config.database

        if (!database) {
          throw new Error("No database linked to this chat")
        }

        const { conflictingPageId } = await sendToBackground({
          name: "checkSaveConflit",
          body: {
            title: document.title,
            database
          }
        })

        const res = await sendToBackground({
          name: "save",
          body: {
            saveBehavior: "override",
            conflictingPageId,
            convId: chatID,
            autoSave: true
          }
        })

        storage.set(STORAGE_KEYS.autosaveStatus, "saved" as AutosaveStatus)
        storage.set(STORAGE_KEYS.saveStatus, null)
        updateChatConfig(chatID, {
          lastSaveStatus: res.err ? "error" : "success",
          lastError: res.err
            ? {
                message: res.err.message ?? null,
                code: res.err.code ?? res.err.status ?? null
              }
            : null
        })
      } catch (err) {
        console.error(err)
        storage.set(STORAGE_KEYS.autosaveStatus, "error" as AutosaveStatus)
        updateChatConfig(chatID, {
          lastSaveStatus: "error",
          lastError: {
            message: err.message ?? JSON.parse(err.body ?? "").message ?? null,
            code: err.code ?? err.status ?? null
          }
        })
      }
    }
  }
})

const onload = async () => {
  let chatID = window.location.href.split("/c/").pop()
  if (chatID?.length != 36) chatID = undefined
  await storage.set(STORAGE_KEYS.chatID, chatID ?? null)
}

// https://stackoverflow.com/questions/3522090/event-when-window-location-href-changes
let oldHref = document.location.href
window.onload = () => {
  onload()
  new MutationObserver((mutations) =>
    mutations.forEach(() => {
      if (oldHref !== document.location.href) {
        oldHref = document.location.href
        onload()
      }
    })
  ).observe(document.querySelector("body")!, { childList: true, subtree: true })
}
