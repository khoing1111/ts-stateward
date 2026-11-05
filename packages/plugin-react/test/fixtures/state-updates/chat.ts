/** A chat client: `on` calls the listener with each message and returns a function that stops it. */
export const chat = {
  on(room: string, listener: (message: string) => void): () => void {
    const timer = setInterval(() => listener(`hello from ${room}`), 5000);
    return () => clearInterval(timer);
  },
};
