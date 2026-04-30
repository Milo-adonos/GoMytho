/**
 * Convertit n'importe quel format image en JPEG via FileReader + canvas.
 * FileReader.readAsDataURL() est plus fiable sur iOS Safari pour HEIC
 * car le navigateur convertit automatiquement en data URL JPEG.
 *
 * Cibles :
 *   - Côté longueur max : 1920 px (suffisant pour Kie 1K-2K, fichier ~400-800 KB)
 *   - Qualité : 0.88 (très bon visuellement, fichier raisonnable)
 *   - Si le fichier reste > 3 MB après une 1ʳᵉ passe (photo très détaillée),
 *     on re-compresse plus aggressivement pour rester sous la limite réseau.
 */
const TARGET_MAX_DIMENSION = 1920
const TARGET_QUALITY = 0.88
const MAX_OUTPUT_BYTES = 3_000_000 // 3 MB max — confortable < limites Vercel/Supabase

export function convertToJpeg(file: File): Promise<{ file: File; preview: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      if (!dataUrl) {
        resolve({ file, preview: '' })
        return
      }

      const img = new Image()

      img.onload = () => {
        let w = img.naturalWidth
        let h = img.naturalHeight
        if (w > TARGET_MAX_DIMENSION || h > TARGET_MAX_DIMENSION) {
          if (w > h) { h = Math.round((h / w) * TARGET_MAX_DIMENSION); w = TARGET_MAX_DIMENSION }
          else { w = Math.round((w / h) * TARGET_MAX_DIMENSION); h = TARGET_MAX_DIMENSION }
        }

        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve({ file, preview: dataUrl })
          return
        }

        ctx.drawImage(img, 0, 0, w, h)

        // Encodage progressif : on tente la qualité cible, et si le fichier
        // est trop gros, on baisse la qualité jusqu'à passer sous le plafond.
        const tryEncode = (quality: number) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve({ file, preview: dataUrl })
                return
              }
              if (blob.size > MAX_OUTPUT_BYTES && quality > 0.55) {
                tryEncode(Math.max(0.55, quality - 0.1))
                return
              }
              const jpegFile = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
              const jpegDataUrl = canvas.toDataURL('image/jpeg', quality)
              resolve({ file: jpegFile, preview: jpegDataUrl })
            },
            'image/jpeg',
            quality
          )
        }
        tryEncode(TARGET_QUALITY)
      }

      img.onerror = () => resolve({ file, preview: dataUrl })
      img.src = dataUrl
    }

    reader.onerror = () => resolve({ file, preview: '' })
    reader.readAsDataURL(file)
  })
}
