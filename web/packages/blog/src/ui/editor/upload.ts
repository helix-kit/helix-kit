export const DEFAULT_UPLOAD_ENDPOINT = '/api/upload';

/** Posts a file to the host's upload endpoint, which must answer with `{ url }`. */
export const uploadFile = async (
  file: File,
  endpoint: string = DEFAULT_UPLOAD_ENDPOINT,
): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Error occurred during file upload.');
  }

  const data = (await response.json()) as { url: string };

  return data.url;
};
