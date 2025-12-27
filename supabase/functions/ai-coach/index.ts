import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

async function readJsonBody(req: Request) {
  try {
    const data = await req.json();
    return data ?? {};
  } catch {
    return {};
  }
}

// Helper: local YYYY-MM-DD (avoids timezone weirdness)
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Generic OpenAI chat call
async function callOpenAIChat(
  messages: Array<{ role: string; content: string }>
) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.6,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("OpenAI error response:", text);
    throw new Error(`OpenAI request failed with status ${resp.status}`);
  }

  const json = await resp.json();
  const content =
    json?.choices?.[0]?.message?.content ??
    "I’m having trouble coming up with a response right now.";

  return String(content);
}

// PLAN MODE: generate JSON and force dates to "today + next 6 days"
async function generatePlanJSON(prompt: string) {
  // Build next 7 dates starting today in local YYYY-MM-DD
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(formatLocalDate(d));
  }

  const messages = [
    {
      role: "system",
      content:
        "You are Elevated Health’s coach, Ella. " +
        "You create simple, realistic 7-day dinner and workout plans for busy adults " +
        "and the grocery items needed. " +
        "You MUST respond with a single VALID JSON object only, no prose, no markdown, no code fences.",
    },
    {
      role: "user",
      content:
        `User request: ${prompt}\n\n` +
        `Today is ${dates[0]}. Create a 7-day plan covering EXACTLY these dates in order:\n` +
        `${dates.join(", ")}\n\n` +
        "Use each date exactly once for both meals and workouts (one main dinner and one workout per day).\n" +
        "Every meal MUST include realistic nutrition estimates with non-zero values for calories, protein_g, carbs_g, and fat_g. If you are unsure, pick a sensible estimate based on the meal name.\n\n" +
        "Return a JSON object with this exact structure:\n" +
        "{\n" +
        '  \"reply\": \"Short, friendly, human-readable summary of the plan.\",\n' +
        '  \"updates\": {\n' +
        '    \"meals\": [\n' +
        "      {\n" +
        '        \"meal_date\": \"YYYY-MM-DD\",  // MUST be one of the dates above\n' +
        '        \"meal_type\": \"breakfast\" | \"lunch\" | \"dinner\",\n' +
        '        \"title\": \"Meal title\",\n' +
        '        \"notes\": \"Optional notes about the meal\",\n' +
        '        \"calories\": 600, // integer, > 0\n' +
        '        \"protein_g\": 35, // integer grams, > 0\n' +
        '        \"carbs_g\": 55, // integer grams, > 0\n' +
        '        \"fat_g\": 18 // integer grams, > 0\n' +
        "      }\n" +
        "    ],\n" +
        '    \"workouts\": [\n' +
        "      {\n" +
        '        \"workout_date\": \"YYYY-MM-DD\",  // MUST be one of the dates above\n' +
        '        \"title\": \"Workout title\",\n' +
        '        \"duration_min\": 30,\n' +
        '        \"notes\": \"Optional workout notes\"\n' +
        "      }\n" +
        "    ],\n" +
        '    \"groceryItems\": [\n' +
        "      {\n" +
        '        \"name\": \"Item name\",\n' +
        '        \"quantity\": \"e.g. 2 lb, 1 dozen\",\n' +
        '        \"category\": \"Protein\" | \"Produce\" | \"Pantry\" | \"Frozen\" | \"Snacks\" | \"Other\"\n' +
        "      }\n" +
        "    ]\n" +
        "  }\n" +
        "}\n\n" +
        "Your entire response MUST be this JSON only. No backticks, no explanation, no other text.",
    },
  ];

  const content = await callOpenAIChat(messages);

  try {
    const parsed = JSON.parse(content);

    const reply =
      typeof parsed.reply === "string"
        ? parsed.reply
        : "I’ve generated a 7-day workout and dinner plan for your family.";

    const updates = parsed.updates ?? {};
    const meals = Array.isArray(updates.meals) ? updates.meals : [];
    const workouts = Array.isArray(updates.workouts) ? updates.workouts : [];
    const groceryItems = Array.isArray(updates.groceryItems)
      ? updates.groceryItems
      : [];

    // 🔥 FORCE DATES to the current week, ignoring whatever the model used
    for (let i = 0; i < meals.length && i < dates.length; i++) {
      meals[i].meal_date = dates[i];
    }
    for (let i = 0; i < workouts.length && i < dates.length; i++) {
      workouts[i].workout_date = dates[i];
    }

    return {
      reply,
      updates: {
        meals,
        workouts,
        groceryItems,
      },
    };
  } catch (err) {
    console.error("Failed to parse OpenAI JSON content:", err);
    console.error("Raw content:", content);
    return {
      reply:
        "I tried to build a detailed weekly plan, but something went wrong parsing it. " +
        "You can still use the app manually for now.",
      updates: null,
    };
  }
}

// CHAT MODE: short, supportive answers
async function generateChatReply(prompt: string) {
  const messages = [
    {
      role: "system",
      content:
        "You are Elevated Health’s coach, Ella. " +
        "You give short, encouraging, practical advice about workouts, nutrition, and habits. " +
        "Keep replies concise and friendly.",
    },
    { role: "user", content: prompt },
  ];

  const content = await callOpenAIChat(messages);

  return {
    reply: content.trim(),
    updates: null,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  try {
    const body = await readJsonBody(req);
    const prompt: string = (body.prompt ?? "").toString();
    const mode: string = (body.mode ?? "chat").toString();

    console.log("ai-coach invoked with:", {
      mode,
      promptSnippet: prompt.slice(0, 80),
    });

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Missing prompt in request body." }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }

    let result;
    if (mode === "plan") {
      result = await generatePlanJSON(prompt);
    } else {
      result = await generateChatReply(prompt);
    }

    const responseBody = {
      reply: result.reply,
      updates: result.updates,
    };

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error("ai-coach top-level error:", err);
    return new Response(
      JSON.stringify({
        error: "Something went wrong inside the ai-coach function.",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
});
