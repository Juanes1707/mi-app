import { File } from 'expo-file-system';

import { supabase } from '@/infrastructure/supabase/supabase-client';

// A backend-issued, single-object upload capability: the server authorized the actor
// and chose the bucket and the path; the client only carries it.
export type SignedUploadCapability = { bucket: string; path: string; token: string };

// Raw bytes of a local device file (file:// or content:// only) that must still have
// exactly the expected size. null for anything else; never throws.
export async function readLocalFileBytes(uri: string, expectedSize: number): Promise<ArrayBuffer | null> {
  if (!/^(file|content):\/\//i.test(uri)) return null;
  try {
    const bytes = await new File(uri).arrayBuffer();
    return bytes.byteLength === expectedSize ? bytes : null;
  } catch {
    return null;
  }
}

// The only Storage data-plane exception: bytes go straight to Storage with the
// capability. true only when Storage confirms exactly that object; never throws.
export async function uploadWithSignedCapability(
  capability: SignedUploadCapability,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.from(capability.bucket).uploadToSignedUrl(
      capability.path, capability.token, bytes, { contentType },
    );
    return error === null && !!data && data.path === capability.path &&
      data.fullPath === `${capability.bucket}/${capability.path}`;
  } catch {
    return false;
  }
}
