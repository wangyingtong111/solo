local keys = KEYS
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local key = keys[1]
local count = redis.call('INCR', key)

if count == 1 then
    redis.call('PEXPIRE', key, window_ms)
end

if count > limit then
    return 0
end

return 1
