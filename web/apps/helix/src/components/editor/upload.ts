export const onUpload = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/upload', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Error occurred during file upload.');
  }

  const data = (await response.json()) as { url: string };

  return data.url;
};
