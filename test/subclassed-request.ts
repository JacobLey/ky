import test from 'ava';

// Some servers (`@hono/node-server`'s `serve`, by default) replace the global `Request` with a subclass, while `Request#clone()` still returns the runtime's own `Request`. Ky's retry clone is such a `Request`, and the retry after a timeout must be sent with a fresh signal, not the one the timeout aborted.
test.serial('retries after a timeout when the global `Request` is a subclass', async t => {
	const OriginalRequest = globalThis.Request;
	globalThis.Request = class extends OriginalRequest {};
	t.teardown(() => {
		globalThis.Request = OriginalRequest;
	});

	const {default: ky} = await import('../source/index.js');
	const sentAborted: boolean[] = [];
	const customFetch: typeof fetch = async input => {
		const request = input as Request;
		sentAborted.push(request.signal.aborted);
		request.signal.throwIfAborted();
		if (sentAborted.length > 1) {
			return new Response('success');
		}

		// The first attempt never answers, until Ky's timeout aborts it
		return new Promise((_resolve, reject) => {
			request.signal.addEventListener('abort', () => {
				reject(request.signal.reason as Error);
			});
		});
	};

	const result = await ky('https://example.com', {
		fetch: customFetch,
		timeout: 50,
		retry: {limit: 1, retryOnTimeout: true, delay: () => 0},
	}).text();

	t.is(result, 'success');
	t.deepEqual(sentAborted, [false, false]);
});

// With a subclass as the global, a `Request` made by the runtime's own class (a clone, or one made before the global was replaced) is still an actual `Request`, accepted as input with its signal.
test.serial('accepts a `Request` made by the runtime\'s own class when the global `Request` is a subclass', async t => {
	const OriginalRequest = globalThis.Request;
	const controller = new AbortController();
	const input = new OriginalRequest('https://example.com/', {headers: {'x-input': 'kept'}, signal: controller.signal});
	globalThis.Request = class extends OriginalRequest {};
	t.teardown(() => {
		globalThis.Request = OriginalRequest;
	});

	const {default: ky} = await import('../source/index.js');
	const customFetch: typeof fetch = async request => new Response((request as Request).headers.get('x-input'));

	t.is(await ky(input, {fetch: customFetch}).text(), 'kept');

	// The input's signal still aborts the request
	controller.abort();
	await t.throwsAsync(ky(input, {fetch: customFetch}).text(), {name: 'AbortError'});
});
