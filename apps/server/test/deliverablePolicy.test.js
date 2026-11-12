import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectDeliverableContract,
  inspectZipBuffer,
  assessWebsiteQuality,
} from '../src/services/deliverablePolicy.js';
import { createTaskPlan } from '../src/services/agentPlanning.js';

test('detects a website build request with ZIP delivery', () => {
  const contract = detectDeliverableContract([
    { role: 'user', content: 'Build a pure HTML task manager website and zip all files.' },
  ]);
  assert.deepEqual(
    {
      required: contract.required,
      archiveRequired: contract.archiveRequired,
      website: contract.website,
    },
    { required: true, archiveRequired: true, website: true }
  );
});

test('does not classify ordinary explanations as project deliverables', () => {
  assert.equal(
    detectDeliverableContract([{ role: 'user', content: 'Explain how localStorage works.' }]),
    null
  );
});

test('deliverable plans require at least five meaningful tasks', () => {
  assert.throws(
    () =>
      createTaskPlan(
        {
          objective: 'Build a website',
          tasks: [
            {
              id: 'a',
              title: 'Build files',
              description: 'Create the requested website source files.',
            },
            {
              id: 'b',
              title: 'Zip files',
              description: 'Package all source files into an archive.',
            },
            {
              id: 'c',
              title: 'Verify',
              description: 'Inspect the archive and verify all expected files.',
            },
          ],
        },
        { deliverableContract: { required: true } }
      ),
    /at least 5/
  );
});

test('ZIP verifier decompresses entries and checks their CRC integrity', () => {
  const archive = Buffer.from(
    'UEsDBBQAAAAIAIiOaV1qhu6faQAAAIsAAAAKAAAAaW5kZXguaHRtbC2NwQrDMAxDfyU75TTyA45PO/Q3slhQQxOXYlr69xtJL+JJIIleYtXvHWH1tjE9iiJMrr6BP2hGaTI1eAm9NOR4Kq7dDo+hWnd0z/FS8TULTq14DxOZ0hz7mtz/ftHOi1IaQGmmabz+AFBLAwQUAAAACACIjmld0nvhe18AAABlAAAACQAAAHN0eWxlLmNzcxXKMQ7CMAwF0KswwlCpMDB44ipOncIXdhyRBIKi3B3x5meMNAQlK38pqG/PebMo4KNxXz6Q+qDruuZ+GvavmUWQ7nR+RZsztFo90e5bK8sbBUHj8FYVKdIl90NxhcwfUEsDBBQAAAAIAIiOaV23z7UlWQAAAGwAAAAJAAAAc2NyaXB0LmpzPYlLCoAgEECPo0J4g9pUu6IziDNUZA5MUxDi3fsQ7d4HyO8rRrEOoD1u6OZNMCJr1Qx9TVGeRg4QVKFNWSXhM3mKGwW0gUataFEmeyd+0shMbP796hdzNhdQSwMEFAAAAAgAiI5pXZ2Ky7QWAAAAFAAAAAkAAABSRUFETUUubWRTVnBJzc3n4goqzVPIyU9OzMmp1AMAUEsBAhQDFAAAAAgAiI5pXWqG7p9pAAAAiwAAAAoAAAAAAAAAAAAAAIABAAAAAGluZGV4Lmh0bWxQSwECFAMUAAAACACIjmld0nvhe18AAABlAAAACQAAAAAAAAAAAAAAgAGRAAAAc3R5bGUuY3NzUEsBAhQDFAAAAAgAiI5pXbfPtSVZAAAAbAAAAAkAAAAAAAAAAAAAAIABFwEAAHNjcmlwdC5qc1BLAQIUAxQAAAAIAIiOaV2disu0FgAAABQAAAAJAAAAAAAAAAAAAACAAZcBAABSRUFETUUubWRQSwUGAAAAAAQABADdAAAA1AEAAAAA',
    'base64'
  );
  const result = inspectZipBuffer(archive);
  assert.equal(result.valid, true);
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ['index.html', 'style.css', 'script.js', 'README.md']
  );
  assert.match(result.entries[0].content.toString('utf8'), /<!doctype html>/i);

  const corrupted = Buffer.from(archive);
  corrupted[40] ^= 0xff;
  assert.equal(inspectZipBuffer(corrupted).valid, false);
});

test('enforces actual Python file delivery for a requested image download without over-planning', () => {
  const contract = detectDeliverableContract([
    { role: 'user', content: 'Download the image from this public URL and give it as a file.' },
  ]);
  assert.equal(contract.required, true);
  assert.equal(contract.executionTool, 'execute_python');
  assert.equal(contract.requiresPlan, false);
});

test('routes original image creation to the image tool instead of Python', () => {
  const contract = detectDeliverableContract([
    { role: 'user', content: 'Generate an original image of a futuristic city.' },
  ]);
  assert.equal(contract.executionTool, 'generate_image');
  assert.equal(contract.requiresPlan, false);
});

test('website quality gate requires semantic HTML, responsive CSS, focus styles, interactive JS, error handling, and README', () => {
  const result = assessWebsiteQuality([
    {
      name: 'index.html',
      uncompressedSize: 300,
      content: Buffer.from(
        '<!doctype html><html><head><title>App</title><meta name="viewport" content="width=device-width"></head><body><main>App</main></body></html>'
      ),
    },
    {
      name: 'style.css',
      uncompressedSize: 200,
      content: Buffer.from(
        '@media(max-width:600px){main{padding:1rem}}button:focus-visible{outline:2px solid}'
      ),
    },
    {
      name: 'script.js',
      uncompressedSize: 200,
      content: Buffer.from(
        "document.addEventListener('click',()=>{try{run()}catch(error){console.error(error)}})"
      ),
    },
    {
      name: 'README.md',
      uncompressedSize: 150,
      content: Buffer.from('# Project\\n\\nRun it locally.'),
    },
  ]);
  assert.equal(result.passed, true);
  assert.equal(Object.values(result.checks).every(Boolean), true);
});

test('website quality gate rejects skeletal files', () => {
  const result = assessWebsiteQuality([
    { name: 'index.html', uncompressedSize: 50, content: Buffer.from('<html></html>') },
    { name: 'style.css', uncompressedSize: 10, content: Buffer.from('body{}') },
    { name: 'script.js', uncompressedSize: 10, content: Buffer.from('console.log(1)') },
  ]);
  assert.equal(result.passed, false);
});

test('deliverable plans must cover design, implementation, QA, packaging, and verification', () => {
  const tasks = [
    {
      id: 'design',
      title: 'Define requirements and design',
      description: 'Define feature scope, requirements, architecture, and visual design.',
    },
    {
      id: 'build',
      title: 'Implement the application',
      description: 'Build and implement the source code and all required files.',
    },
    {
      id: 'qa',
      title: 'Run quality tests',
      description: 'Run functional tests, linting, and validation; fix any failures.',
    },
    {
      id: 'zip',
      title: 'Package project ZIP',
      description: 'Package the completed project files and README into a ZIP archive.',
    },
    {
      id: 'verify',
      title: 'Verify and deliver',
      description: 'Inspect the completed deliverable, verify integrity, and confirm it is ready.',
    },
  ];
  assert.doesNotThrow(() =>
    createTaskPlan(
      { objective: 'Build a website and ZIP it', tasks },
      { deliverableContract: { required: true, archiveRequired: true } }
    )
  );
  assert.throws(
    () =>
      createTaskPlan(
        {
          objective: 'Build a website and ZIP it',
          tasks: tasks.map((task) =>
            task.id === 'zip'
              ? {
                  ...task,
                  title: 'Prepare handoff',
                  description: 'Prepare the final handoff for the user.',
                }
              : task
          ),
        },
        { deliverableContract: { required: true, archiveRequired: true } }
      ),
    /packaging/
  );
});

test('deliverable plans are capped at eight focused tasks', () => {
  const tasks = Array.from({ length: 9 }, (_, index) => ({
    id: `task-${index + 1}`,
    title: `Task ${index + 1}`,
    description: 'A meaningful task description for the project workflow.',
  }));
  assert.throws(
    () =>
      createTaskPlan(
        { objective: 'Build a project', tasks },
        { deliverableContract: { required: true } }
      ),
    /no more than 8/
  );
});

test('detects a standalone Python script as a file deliverable', () => {
  const contract = detectDeliverableContract([
    { role: 'user', content: 'Generate a simple Python script of drawing multiple circles.' },
  ]);
  assert.equal(contract.required, true);
  assert.equal(contract.executionTool, 'execute_python');
  assert.equal(contract.archiveRequired, false);
});
