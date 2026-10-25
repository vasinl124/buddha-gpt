import { HealthStatus } from "@/components/health-status";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Buddha GPT</CardTitle>
          <CardDescription>A conversation with the Buddha where every quote is real.</CardDescription>
        </CardHeader>
        <CardContent>
          <HealthStatus />
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">Phase 0 skeleton. The chat arrives in Phase 2.</p>
        </CardFooter>
      </Card>
    </main>
  );
}
