import { ErrorBoundary } from "./features/app/chrome";
import { AppShell } from "./features/app/AppShell";
import { useInactiveChatArchive } from "./hooks/use-inactive-chat-archive";

export default function App() {
  useInactiveChatArchive();
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
