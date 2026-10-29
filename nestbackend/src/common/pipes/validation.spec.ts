import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';

import { CreateProjectDto } from 'src/projects/dto/create-project.dto';
import { ListTasksQuery } from 'src/tasks/dto/task.dto';
import { CreateUserDto } from 'src/users/dto/create-user.dto';

import { ParseObjectIdPipe } from './parse-object-id.pipe';

/**
 * =============================================================================
 * The ValidationPipe's behaviour, asserted rather than described.
 * =============================================================================
 * A pipe is just a class with a `transform` method, so it can be unit-tested
 * directly - no HTTP, no container, milliseconds. That is worth knowing: people
 * routinely spin up a whole application to test validation rules that a
 * three-line unit test covers.
 * =============================================================================
 */
describe('Global ValidationPipe', () => {
  // The same configuration as the APP_PIPE provider in app.module.ts.
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });

  const meta = (metatype: unknown): ArgumentMetadata =>
    ({ type: 'body', metatype, data: '' }) as ArgumentMetadata;

  describe('transform: true', () => {
    it('produces a REAL DTO instance, not a look-alike object', async () => {
      const result = await pipe.transform(
        { email: 'Ada@Example.com ', name: ' Ada ', password: 'Password123' },
        meta(CreateUserDto),
      );

      // Without `transform: true` this would be a plain object and the
      // assertion would fail - which is exactly why `@Body() dto: CreateUserDto`
      // is a compile-time fiction until the pipe is registered.
      expect(result).toBeInstanceOf(CreateUserDto);
    });

    it('runs @Transform BEFORE validation, so normalisation is applied', async () => {
      const result = (await pipe.transform(
        { email: '  Ada@Example.COM  ', name: '  Ada Lovelace  ', password: 'Password123' },
        meta(CreateUserDto),
      )) as CreateUserDto;

      expect(result.email).toBe('ada@example.com');
      expect(result.name).toBe('Ada Lovelace');
    });

    it('converts query strings to numbers via @Type, and the getter works', async () => {
      const result = (await pipe.transform(
        { page: '3', limit: '10' },
        meta(ListTasksQuery),
      )) as ListTasksQuery;

      expect(result.page).toBe(3);
      expect(typeof result.page).toBe('number');
      // `skip` is a GETTER on the class. A plain object has no prototype, so
      // this only works because a real instance was constructed.
      expect(result.skip).toBe(20);
    });

    it('applies class defaults for absent optional fields', async () => {
      const result = (await pipe.transform({}, meta(ListTasksQuery))) as ListTasksQuery;

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('whitelist + forbidNonWhitelisted', () => {
    it('REJECTS a property that is not on the DTO', async () => {
      /**
       * The mass-assignment defence, demonstrated. Without `whitelist`, this
       * `isAdmin` would reach the service and could be written straight into the
       * document by an `Object.assign` or `new Model(dto)`.
       */
      await expect(
        pipe.transform(
          { email: 'a@b.co', name: 'Ada', password: 'Password123', isAdmin: true },
          meta(CreateUserDto),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('names the offending property in the error', async () => {
      /**
       * NOTE how the message is read. `toThrow(/pattern/)` matches
       * `error.message`, which for a Nest HttpException is just
       * "Bad Request Exception" - the useful detail lives in
       * `getResponse().message`, an ARRAY of constraint failures.
       *
       * Getting this wrong (as I did first) produces a test that LOOKS right,
       * fails for a confusing reason, and - if the pattern had happened to
       * match - would have asserted nothing useful at all.
       */
      const error = await pipe
        .transform(
          { email: 'a@b.co', name: 'Ada', password: 'Password123', isAdmin: true },
          meta(CreateUserDto),
        )
        .catch((caught: BadRequestException) => caught.getResponse() as { message: string[] });

      expect(error.message.join(' ')).toMatch(/isAdmin should not exist/);
    });
  });

  describe('error reporting', () => {
    it('reports EVERY failure at once, not just the first', async () => {
      const error = await pipe
        .transform({ email: 'not-an-email', name: 'x', password: 'weak' }, meta(CreateUserDto))
        .catch((caught: BadRequestException) => caught.getResponse() as { message: string[] });

      // A form with three bad fields should tell the user about all three,
      // rather than making them submit three times.
      expect(error.message.length).toBeGreaterThanOrEqual(3);
    });

    it('gives an actionable message, not just "invalid"', async () => {
      const error = await pipe
        .transform({ email: 'a@b.co', name: 'Ada', password: 'short' }, meta(CreateUserDto))
        .catch((caught: BadRequestException) => caught.getResponse() as { message: string[] });

      expect(error.message.join(' ')).toMatch(/at least 10 characters/);
    });
  });

  describe('nested validation', () => {
    it('validates ARRAY ELEMENTS thanks to @ValidateNested + @Type', async () => {
      /**
       * The most commonly missed validation hole in Nest applications: without
       * `@Type(() => AddProjectMemberDto)`, the elements stay plain objects,
       * class-validator has no metadata to check, and anything passes.
       */
      const error = await pipe
        .transform(
          {
            key: 'WEB',
            name: 'Website',
            members: [{ userId: 'definitely-not-an-object-id' }],
          },
          meta(CreateProjectDto),
        )
        .catch((caught: BadRequestException) => caught.getResponse() as { message: string[] });

      expect(JSON.stringify(error.message)).toMatch(/userId/);
    });

    it('accepts a valid nested array', async () => {
      const result = (await pipe.transform(
        {
          key: 'web',
          name: 'Website',
          members: [{ userId: '507f1f77bcf86cd799439012', role: 'member' }],
        },
        meta(CreateProjectDto),
      )) as CreateProjectDto;

      expect(result.key).toBe('WEB'); // @TrimUpper ran
      expect(result.members).toHaveLength(1);
    });
  });
});

describe('ParseObjectIdPipe', () => {
  const pipe = new ParseObjectIdPipe();
  const meta = { type: 'param', data: 'id' } as ArgumentMetadata;

  it('passes a valid ObjectId through unchanged', () => {
    expect(pipe.transform('507f1f77bcf86cd799439011', meta)).toBe('507f1f77bcf86cd799439011');
  });

  it('rejects a malformed id with 400 instead of letting it become a 500', () => {
    expect(() => pipe.transform('nope', meta)).toThrow(BadRequestException);
  });

  it('names the parameter in the message', () => {
    expect(() => pipe.transform('nope', meta)).toThrow(/id must be a valid MongoDB ObjectId/);
  });
});
