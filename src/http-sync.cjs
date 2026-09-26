const input = JSON.parse(process.argv[2] || '{}');

async function main() {
  const controller = new AbortController();
  const timeoutMs = Number(input.timeoutMs || 30000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(String(input.url || ''), {
      method: String(input.method || 'GET').toUpperCase(),
      headers: input.headers || {},
      body: input.body ? String(input.body) : undefined,
      redirect: 'follow',
      signal: controller.signal
    });
    const body = await response.text();
    console.log(JSON.stringify({
      statusCode: response.status,
      status: response.status,
      ok: response.ok,
      url: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      body
    }));
  } catch (error) {
    console.log(JSON.stringify({
      error: error && error.name === 'AbortError' ? 'request timeout' : String(error && error.message || error)
    }));
    process.exitCode = 2;
  } finally {
    clearTimeout(timer);
  }
}

main();
