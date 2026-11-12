import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, after, describe, it } from 'node:test'
import sharp from 'sharp'
import { z } from 'zod'
import { startHomeFixture } from '../testing/homeFixture.ts'

const imageShape = z.object({ id: z.string(), url: z.string(), fullUrl: z.never().optional() })
const showcaseShape = z.object({ image: imageShape, title: z.string(), url: z.string() })
const homeShape = z.object({
  revision: z.number(), aboutMe: z.string(),
  projects: z.array(showcaseShape), artwork: z.array(showcaseShape),
  contacts: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })),
  news: z.array(z.object({
    id: z.string(), date: z.string(), preview: z.string(),
    previewImage: imageShape.nullable(), body: z.string().optional(),
  })),
})

async function readHome(response: Response) {
  return z.object({ home: homeShape }).parse(await response.json()).home
}

describe('editable home', { skip: !process.env.HOME_TEST_MONGODB_URI }, () => {
  let fixture: Awaited<ReturnType<typeof startHomeFixture>>
  let image: { id: string; url: string }
  let revision = 0
  const newsId = randomUUID()

  before(async () => { fixture = await startHomeFixture() })
  after(async () => { await fixture?.close() })

  function call(path: string, method = 'GET', body?: unknown, authenticated = true) {
    return fetch(`${fixture.baseUrl}/api${path}`, {
      method,
      headers: {
        ...(authenticated ? { Cookie: fixture.cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  }

  function content() {
    return {
      revision, aboutMe: 'A saved about paragraph.\nA second line.',
      projects: Array.from({ length: 4 }, (_, index) => ({ imageId: image.id, title: `Project ${index}`, url: 'https://example.com/project' })),
      artwork: Array.from({ length: 4 }, () => ({ imageId: image.id, title: '', url: '' })),
      news: [{
        id: newsId, date: '2026-11-12', preview: 'A real event preview',
        previewImageId: image.id, body: '**Event details**\n\n[[image:1]]', imageIds: [image.id],
      }],
      contacts: Array.from({ length: 8 }, (_, index) => ({ id: randomUUID(), title: `Social ${index}`, url: 'https://example.com/social' })),
    }
  }

  it('requires admin auth for reading, saving and uploading home content', async () => {
    for (const [path, method] of [['/admin/home', 'GET'], ['/admin/home', 'PUT'], ['/admin/home/images', 'POST']]) {
      const response = await call(path!, method!, undefined, false)
      assert.equal(response.status, 401)
    }
    const home = await readHome(await call('/home'))
    assert.equal(home.revision, 0)
    assert.deepEqual(home.news, [])
  })

  it('uploads a decoded image and serves its generated preview; rejects bad files', async () => {
    const png = await sharp({ create: { width: 1400, height: 900, channels: 3, background: '#aabbcc' } }).png().toBuffer()
    const upload = async (bytes: Uint8Array, type: string) => {
      const form = new FormData()
      form.append('image', new Blob([new Uint8Array(bytes)], { type }), 'test.png')
      return fetch(`${fixture.baseUrl}/api/admin/home/images`, { method: 'POST', headers: { Cookie: fixture.cookie }, body: form })
    }
    const response = await upload(png, 'image/png')
    assert.equal(response.status, 201)
    image = z.object({ image: imageShape }).parse(await response.json()).image
    const preview = await fetch(image.url)
    assert.equal(preview.status, 200)
    assert.equal(preview.headers.get('content-type'), 'image/webp')
    const metadata = await sharp(Buffer.from(await preview.arrayBuffer())).metadata()
    assert.equal(metadata.width, 900)
    const original = [...fixture.objects.values()].find((object) => object.type === 'image/png')
    assert.deepEqual(original?.bytes, png)
    const count = fixture.objects.size
    assert.equal((await upload(new Uint8Array([1, 2, 3]), 'image/jpeg')).status, 400)
    assert.equal((await upload(new Uint8Array([1, 2, 3]), 'image/svg+xml')).status, 400)
    assert.equal(fixture.objects.size, count)
  })

  it('persists all sections, accepts more than four contacts, and links full news separately', async () => {
    const saved = await call('/admin/home', 'PUT', content())
    assert.equal(saved.status, 200, await saved.clone().text())
    const admin = await readHome(saved)
    revision = admin.revision
    assert.equal(admin.projects.length, 4)
    assert.equal(admin.contacts.length, 8)
    const home = await readHome(await call('/home'))
    assert.equal(home.aboutMe, content().aboutMe)
    assert.equal(home.projects[0]?.image.id, image.id)
    assert.equal(home.news.length, 1)
    assert.equal(home.news[0]?.previewImage?.id, image.id)
    assert.equal(home.news[0]?.body, undefined)
    const { news } = z.object({ news: z.object({ body: z.string(), images: z.array(imageShape) }) })
      .parse(await (await call(`/home/news/${newsId}`)).json())
    assert.equal(news.body, content().news[0]!.body)
    assert.equal(news.images[0]?.id, image.id)
    const { HomeModel } = await import('../models/Home.ts')
    const stored = await HomeModel.findById('home').exec()
    assert.equal(stored?.aboutMe, home.aboutMe)
    assert.equal(stored?.news[0]?.id, newsId)
  })

  it('enforces four-image caps, rejects unsafe or missing references, and prevents lost updates', async () => {
    const fifth = content()
    fifth.projects.push(fifth.projects[0]!)
    assert.equal((await call('/admin/home', 'PUT', fifth)).status, 400)
    const fifthArt = content()
    fifthArt.artwork.push(fifthArt.artwork[0]!)
    assert.equal((await call('/admin/home', 'PUT', fifthArt)).status, 400)
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'not a url']) {
      const unsafe = content()
      unsafe.contacts[0]!.url = url
      assert.equal((await call('/admin/home', 'PUT', unsafe)).status, 400)
    }
    const missing = content()
    missing.projects[0]!.imageId = '000000000000000000000001'
    assert.equal((await call('/admin/home', 'PUT', missing)).status, 400)
    const invalidDate = content()
    invalidDate.news[0]!.date = '2026-02-31'
    assert.equal((await call('/admin/home', 'PUT', invalidDate)).status, 400)
    const emptyBody = content()
    emptyBody.news[0]!.body = ' '
    assert.equal((await call('/admin/home', 'PUT', emptyBody)).status, 400)
    const duplicates = content()
    duplicates.news.push(duplicates.news[0]!)
    assert.equal((await call('/admin/home', 'PUT', duplicates)).status, 400)
    const stale = content()
    stale.revision = 0
    assert.equal((await call('/admin/home', 'PUT', stale)).status, 409)
    const home = await readHome(await call('/home'))
    assert.equal(home.revision, revision)
    assert.equal((await call(`/home/news/${randomUUID()}`)).status, 404)
  })

  it('lets only one of two concurrent editors publish the same revision', async () => {
    const first = { ...content(), aboutMe: 'First editor' }
    const second = { ...content(), aboutMe: 'Second editor' }
    const responses = await Promise.all([
      call('/admin/home', 'PUT', first),
      call('/admin/home', 'PUT', second),
    ])
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
    const home = await readHome(await call('/home'))
    assert.equal(home.revision, revision + 1)
    assert.equal(home.aboutMe, responses[0]?.status === 200 ? first.aboutMe : second.aboutMe)
    revision = home.revision
  })

  it('clears saved sections without restoring mock data or broken news links', async () => {
    const cleared = { ...content(), aboutMe: '', projects: [], artwork: [], news: [], contacts: [] }
    assert.equal((await call('/admin/home', 'PUT', cleared)).status, 200)
    const home = await readHome(await call('/home'))
    assert.equal(home.aboutMe, '')
    assert.deepEqual(home.contacts, [])
    assert.equal((await call(`/home/news/${newsId}`)).status, 404)
  })
})
