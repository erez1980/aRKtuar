/* aRKtuar AI - public client configuration.
   These values are safe to publish: the publishable key only allows what
   Row Level Security and the Edge Function permit. The Anthropic API key
   never reaches the browser; it lives as a Supabase Edge Function secret. */
window.ARK_CONFIG = {
  supabaseUrl: 'https://nsufrchdgyomgbqmvdlr.supabase.co',
  supabaseKey: 'sb_publishable_IvULS5z_VVUo6EqRsLDnkA_ORHd-Vn8',
  aiFunction: 'arktuar-ai',
  maxFileMB: 8,
  version: 'v1.0.0'
};
