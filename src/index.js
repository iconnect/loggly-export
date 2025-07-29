require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const dayjs = require("dayjs");
const path = require("path");

const START_TIME = "2025-06-29T00:00:00.000Z";
const outputDir = "output";
const MAX_EVENTS = 5000;

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processChunk = async (fromTime) => {
  console.log(`${fromTime}`);
  const untilTime = fromTime.add(1, 'day'); // very generous upper bound

  try {
    const searchResponse = await axios.get("https://irisconnect.loggly.com/apiv2/search", {
      headers: {
        Authorization: `Bearer ${process.env.LOGGLY_TOKEN}`
      },
      params: {
        q: "syslog.host:atlas-eu",
        size: MAX_EVENTS,
        from: fromTime.toISOString(),
        until: untilTime.toISOString()
      }
    });

    const rsid = searchResponse.data.rsid.id;
    console.log(`[${fromTime.format()}] RSID: ${rsid}`);

    const eventsResponse = await axios.get("https://irisconnect.loggly.com/apiv2/events", {
      headers: {
        Authorization: `Bearer ${process.env.LOGGLY_TOKEN}`
      },
      params: { rsid }
    });

    const events = eventsResponse.data.events || [];
    if (events.length === 0) {
      console.log(`[${fromTime.format()}] No events found. Done.`);
      return null;
    }

    const outputFile = path.join(outputDir, `${fromTime.format("YYYY-MM-DDTHH-mm-ss")}.json`);
    fs.writeFileSync(outputFile, JSON.stringify(eventsResponse.data, null, 2));
    console.log(`[${fromTime.format()}] Saved ${events.length} events`);

    // Find timestamp of last event
    const lastTimestamp = events[events.length - 1].timestamp;
    if (!lastTimestamp) {
      throw new Error("Could not extract last event timestamp");
    }

    const nextFromTime = dayjs(lastTimestamp).add(1, "minute"); // avoid duplicates
    return nextFromTime;
    return fromTime.add(1, 'day'); // very generous upper bound
  } catch (err) {
    console.error(`[${fromTime.format()}] Error:`, err.response?.data || err.message);
    return null;
  }
};

const main = async () => {
  let current = dayjs(START_TIME);
  const hardLimit = dayjs();

  while (current.isBefore(hardLimit)) {
    const next = await processChunk(current);
    if (!next || !next.isAfter(current)) {
      console.log(`🛑 Stopping at ${current.format()}`);
      break;
    }
    current = next;
    await sleep(1000); // optional rate-limiting
  }

  console.log("✅ All done.");
};

main();
