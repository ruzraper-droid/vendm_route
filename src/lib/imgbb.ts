export const LS_IMGBB_KEY = "app_imgbb_api_key"

/**
 * Upload image to backend (which securely uploads to ImgBB)
 * This keeps the API key server-side only
 */
export async function uploadImageToImgBB(file: File): Promise<string> {
  const formData = new FormData()
  formData.append("image", file)

  const response = await fetch(`/api/upload`, {
    method: "POST",
    body: formData,
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.details ?? payload?.error ?? "Upload failed")
  }

  const imageUrl = payload.data?.url
  if (!imageUrl) {
    throw new Error("Upload succeeded without an image URL")
  }

  return imageUrl as string
}