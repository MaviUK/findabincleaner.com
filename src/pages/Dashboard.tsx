import { Link } from "react-router-dom";

export default function Dashboard() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cleaner Dashboard</h1>
      <div className="p-4 border rounded-xl flex items-center gap-4">
        <div className="h-14 w-14 bg-gray-200 rounded" />
        <div className="flex-1">
          <div className="font-semibold">Your Business Name</div>
          <div className="text-sm text-gray-600">Your address here…</div>
        </div>
        <Link to="/settings" className="bg-black text-white px-3 py-2 rounded">Edit profile</Link>
      </div>

      <h2 className="text-xl font-semibold">Your Service Areas</h2>
      <div className="p-4 border rounded-xl text-sm text-gray-600">
        (Stub) Service areas editor goes here.
      </div>
    </div>
  );
}
