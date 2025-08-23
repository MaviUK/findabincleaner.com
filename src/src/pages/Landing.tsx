import FindCleaners from "../components/FindCleaners";

export default function Landing() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Find a Bin Cleaner</h1>
      <FindCleaners />
    </div>
  );
}
