import AgentGenerateForm from "../components/AgentGenerateForm";

export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">Gen Slides AI</h1>
      <AgentGenerateForm />
    </main>
  );
}