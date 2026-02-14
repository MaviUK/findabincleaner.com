import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet";

export default function ServiceCityPage() {
  const { city } = useParams();

  const cityName = city
    ?.replace(/-/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());

  return (
    <>
      <Helmet>
        <title>Window Cleaners in {cityName} | Compare Local Professionals</title>
        <meta
          name="description"
          content={`Find trusted window cleaners in ${cityName}. Compare local professionals, read reviews and request free quotes today.`}
        />
      </Helmet>

      <div className="container">
        <h1>Window Cleaners in {cityName}</h1>

        <p>
          Looking for reliable window cleaners in {cityName}? We help you
          compare trusted local professionals, read reviews and request quotes
          quickly and easily.
        </p>

        {/* Provider list goes here */}

        <h2>Why Hire a Professional Window Cleaner in {cityName}?</h2>
        <p>
          Professional window cleaners in {cityName} use purified water
          systems and specialist equipment to leave streak-free results.
        </p>

        <h2>Frequently Asked Questions</h2>

        <h3>How much does window cleaning cost in {cityName}?</h3>
        <p>
          Prices vary depending on property size, access and frequency of
          cleaning.
        </p>

        <h3>How often should windows be cleaned?</h3>
        <p>
          Most homes benefit from cleaning every 4–8 weeks.
        </p>
      </div>
    </>
  );
}
