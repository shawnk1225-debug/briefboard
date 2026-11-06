import { backend } from '../data/backend'
import { prepareImage } from '../lib/images'
import { addCard, useStore } from '../store/store'
import { showToast } from '../ui/feedback'

// The per-file limit on Supabase's free plan, also set on the storage bucket.
export const MAX_FILE_BYTES = 50 * 1024 * 1024

export const fileExtension = (name: string) => {
  const match = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  return match ? match[1] : 'bin'
}

async function addAttachment(file: File, x: number, y: number) {
  if (file.size > MAX_FILE_BYTES) {
    showToast(`${file.name} is over the 50 MB limit. For long videos, paste a link instead.`)
    return
  }
  showToast(`Uploading ${file.name}…`)
  const ref = await backend.uploadFile(file, fileExtension(file.name))
  addCard('file', x, y, { ref, name: file.name, size: file.size, mime: file.type })
}

// Images become image cards. Everything else, including image formats the browser
// can't process, becomes a file card.
export async function addFiles(files: File[], x: number, y: number) {
  if (useStore.getState().practice) {
    showToast("Images and files can't be added to the practice board.")
    return
  }
  let offset = 0
  for (const file of files) {
    const at = { x: x + offset, y: y + offset }
    offset += 28
    try {
      if (file.type.startsWith('image/')) {
        let prepared
        try {
          prepared = await prepareImage(file)
        } catch {
          await addAttachment(file, at.x, at.y)
          continue
        }
        const ref = await backend.uploadImage(prepared.blob, prepared.extension)
        addCard('image', at.x, at.y, { ref, aspect: prepared.aspect })
      } else {
        await addAttachment(file, at.x, at.y)
      }
    } catch (err) {
      console.error(err)
      showToast(`Couldn't add ${file.name || 'that file'}.`)
    }
  }
}
