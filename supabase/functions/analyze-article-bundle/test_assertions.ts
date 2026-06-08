export function assert(
  value: unknown,
  message = "Expected value to be truthy",
) {
  if (!value) throw new Error(message);
}

export function assertEquals(actual: unknown, expected: unknown) {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `Expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`,
    );
  }
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  expectedMessage: string,
) {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      throw new Error(
        `Expected rejection to include ${expectedMessage}, got ${message}`,
      );
    }
    return;
  }
  throw new Error("Expected function to reject");
}

function deepEqual(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
