import { ConfigService } from '@nestjs/config';
import { AcademicAiService } from '../../src/integrations/academic-ai.service';

describe('AcademicAiService provider contract', () => {
  const settings = {
    aiUrl: 'https://text.example.test/chat/completions',
    aiKey: 'text-secret',
    aiModel: 'text-model',
    visionUrl: 'https://vision.example.test/chat/completions',
    visionKey: 'vision-secret',
    visionModel: 'vision-model',
  };
  const service = (overrides = {}): AcademicAiService =>
    new AcademicAiService(new ConfigService({ academic: { ...settings, ...overrides } }) as never);
  const response = (content = '{"answers":[]}', finish = 'stop'): Response =>
    new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }));
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response());
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses separate vision credentials and sends image bytes with the question context', async () => {
    const image = 'data:image/png;base64,aGVsbG8=';
    await expect(service().json('Read only', { questions: [] }, [image])).resolves.toEqual({
      answers: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      settings.visionUrl,
      expect.objectContaining({
        headers: { Authorization: 'Bearer vision-secret', 'Content-Type': 'application/json' },
        redirect: 'error',
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as unknown;
    expect(body).toMatchObject({
      model: 'vision-model',
      messages: [
        { role: 'system' },
        {
          role: 'user',
          content: [
            { type: 'text', text: '{"questions":[]}' },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
    });
  });
  it('allows vision transcription independently of text grading configuration', async () => {
    await expect(
      service({ aiUrl: '', aiKey: '', aiModel: '' }).json('Read', {}, [
        'data:image/png;base64,eA==',
      ]),
    ).resolves.toEqual({ answers: [] });
  });
  it('uses the text provider for rubric scoring', async () => {
    await service().json('Grade', {});
    expect(fetchMock.mock.calls[0][0]).toBe(settings.aiUrl);
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: 'Bearer text-secret',
    });
  });
  it('fails before making a request if vision is not configured', async () => {
    await expect(service({ visionKey: '' }).json('Read', {}, ['image'])).rejects.toMatchObject({
      code: 'AI_VISION_UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [429, 'AI_PROVIDER_RATE_LIMITED'],
    [500, 'AI_PROVIDER_REJECTED'],
  ])('returns a safe code for HTTP %s without exposing upstream content', async (status, code) => {
    fetchMock.mockResolvedValue(
      new Response('private prompt and secret', { status: Number(status) }),
    );
    await expect(service().json('Grade', {})).rejects.toMatchObject({
      code,
      message: 'AI provider rejected the request',
    });
  });
  it.each([
    ['TimeoutError', 'AI_PROVIDER_TIMEOUT'],
    ['AbortError', 'AI_PROVIDER_TIMEOUT'],
    ['TypeError', 'AI_PROVIDER_UNAVAILABLE'],
  ])('classifies %s without leaking the network error', async (name, code) => {
    fetchMock.mockRejectedValue(Object.assign(new Error('secret endpoint detail'), { name }));
    await expect(service().json('Grade', {})).rejects.toMatchObject({ code });
  });
  it.each([
    (): Response => new Response('not-json'),
    (): Response => new Response('{}'),
    (): Response => response('{"scores":', 'length'),
    (): Response => response('not-json'),
  ])('rejects malformed or incomplete provider output %#', async (makeResponse) => {
    fetchMock.mockResolvedValue(makeResponse());
    await expect(service().json('Grade', {})).rejects.toMatchObject({
      code: 'AI_RESPONSE_INVALID',
    });
  });
});
