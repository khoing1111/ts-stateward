import { toast, useSendReplyMutation } from "./api.js";

export function useReply(threadId: string, setText: (text: string) => void) {
  const [sendReply] = useSendReplyMutation();
  return async (text: string): Promise<void> => {
    try {
      await sendReply({ threadId, text });
      setText("");
    } catch {
      toast.error("Could not send the reply");
    }
  };
}

export function useQuickReply(
  threadId: string,
  setText: (text: string) => void,
  setSending: (sending: boolean) => void,
) {
  const [sendReply] = useSendReplyMutation();
  return async (text: string): Promise<void> => {
    setSending(true);
    await sendReply({ threadId, text });
    setSending(false);
    setText("");
  };
}
