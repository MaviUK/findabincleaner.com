export default function Landing() {
  return (
    <section className="grid md:grid-cols-2 gap-8 items-center">
      <div className="space-y-4">
        <h1 className="text-3xl sm:text-4xl font-bold text-ink-900">
          Book a trusted wheelie bin cleaner in minutes
        </h1>
        <p className="text-ink-600">
          Compare local cleaners, check service areas and book online. Clean bins, happy homes.
        </p>

        <div className="flex gap-2">
          <a href="#/dashboard" className="btn btn-primary">I’m a cleaner</a>
          <a href="#/" className="btn btn-ghost">Find cleaners</a>
        </div>

        <p className="muted">Free listing for cleaners • No signup fees</p>
      </div>

      <div className="card">
        <div className="card-pad">
          <form
            onSubmit={(e) => { e.preventDefault(); window.location.hash = "#/"; }}
            className="space-y-3"
          >
            <label className="block">
              <span className="muted">Enter postcode</span>
              <input className="input mt-1" placeholder="e.g. BT20 5NF" />
            </label>
            <button className="btn btn-primary w-full">Find cleaners</button>
          </form>
        </div>
      </div>
    </section>
  );
  )
