/**
 * This file is part of the Starseed Bot WhatsApp project, solely developed and maintained by Lia Wynn.
 * https://github.com/itsliaaa/starseed
 *
 * All rights reserved.
 *
 * - You are NOT allowed to copy, rewrite, modify, redistribute, or reuse this file in any form.
 * - You are NOT allowed to claim this file or any part of this project as your own.
 * - This credit notice must NOT be removed or altered.
 * - This file may ONLY be used within the Starseed project.
 */

import { delay } from '@itsliaaa/baileys'
import { watch } from 'fs'
import { readdir, stat } from 'fs/promises'
import { basename, join } from 'path'

import { toArray } from './Utilities.js'

const runWithConcurrency = async (items, limit, worker) => {
   const queue = [...items]

   const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
         const item = queue.shift()
         await worker(item)
      }
   })

   await Promise.all(workers)
}

export const FileCache = new Map()
export const ModuleCache = new Map()
export const CommandIndex = new Map()
export const EventIndex = new Set()
const Processing = new Set()

const normalizeCommand = (string) =>
   string
      .replace(/\s+/g, '')
      .toLowerCase()

export const indexModule = (module) => {
   if (module.command) {
      for (const key of ['command', 'hidden'])
         for (const value of toArray(module[key])) {
            if (typeof value !== 'string') continue
            CommandIndex.set(normalizeCommand(value), module)
         }
   }
   else if (!EventIndex.has(module))
      EventIndex.add(module)
}

export const unindexModule = (filePath) => {
   const cachedModule = ModuleCache.get(filePath)
   if (!cachedModule) return

   if (cachedModule.command) {
      for (const key of ['command', 'hidden'])
         for (const value of toArray(cachedModule[key]))
            CommandIndex.delete(normalizeCommand(value), null)
   }
   else if (EventIndex.has(cachedModule))
      EventIndex.delete(cachedModule)

   ModuleCache.delete(filePath)
}

const loadModule = async (filePath) => {
   try {
      const url = new URL(`file://${join(process.cwd(), filePath)}?update=${Date.now()}`)
      const mod = await import(url.href)
      const module = mod.default ?? mod

      if (module?.run) {
         ModuleCache.set(filePath, module)
         indexModule(module)
      }

      return mod
   }
   catch (error) {
      console.error('❌ Failed to load', ':', filePath)
      console.error(error)
   }
}

export const scanDirectory = async (directory) => {
   const entries = await readdir(directory, { withFileTypes: true })

   const files = []
   const directories = []

   for (const entry of entries) {
      const fullPath = join(directory, entry.name)

      if (entry.isDirectory())
         directories.push(fullPath)
      else if (entry.isFile() || fullPath.endsWith('.js'))
         files.push(fullPath)
   }

   await runWithConcurrency(files, 8, async (fullPath) => {
      const stats = await stat(fullPath)

      FileCache.set(fullPath, {
         mtimeMs: stats.mtimeMs,
         size: stats.size
      })

      await loadModule(fullPath)
   })

   for (const fullPath of directories)
      await scanDirectory(fullPath)

   await watchDirectory(directory)
}

const watchDirectory = async (directory) => {
   watch(directory, (event, fileName) => {
      if (!fileName) return

      handleChange(join(directory, fileName))
   })

   const entries = await readdir(directory, { withFileTypes: true })

   for (const entry of entries)
      if (entry.isDirectory())
         watchDirectory(join(directory, entry.name))
}

const handleChange = async (filePath) => {
   if (!filePath.endsWith('.js')) return
   if (Processing.has(filePath)) return

   Processing.add(filePath)

   try {
      await delay(500)

      const stats = await stat(filePath)

      if (!stats.isFile()) return

      const cachedFile = FileCache.get(filePath)

      const changed =
         !cachedFile ||
         cachedFile.mtimeMs !== stats.mtimeMs ||
         cachedFile.size !== stats.size

      if (!changed) return

      unindexModule(filePath)
      FileCache.set(filePath, {
         mtimeMs: stats.mtimeMs,
         size: stats.size
      })

      await loadModule(filePath)

      console.log(cachedFile ? '🔔 Updated' : '➕ Added', ':', filePath)
   }
   catch {
      FileCache.delete(filePath)
      unindexModule(filePath)
      console.log('🗑️ Deleted', ':', filePath)
   }
   finally {
      await delay(300)

      Processing.delete(filePath)
   }
}